import { endGroup, info, setFailed, startGroup, warning } from "@actions/core";
import { getOctokit } from "@actions/github";
import { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { retry } from "@octokit/plugin-retry";
import fs from "fs/promises";
import { DownloaderHelper } from "node-downloader-helper";
import { tmpdir } from "os";
import { join } from "path";
import { getGitHubTokens, getRepositoriesNames, getTagNames, type RepositoryName } from "./inputs.js";

async function main() {
  try {
    // Get the repositories, tags and tokens
    startGroup("Inputs");
    const [sourceRepo, destRepo] = getRepositoriesNames();
    const [sourceTag, maybeDestinationTag] = getTagNames();
    const tokens = getGitHubTokens();
    endGroup();

    // Initialize the GitHub clients
    startGroup("Creating GitHub clients");
    const [sourceOcto, destOcto] = tokens.map((token) => getOctokit(token, {
      plugins: [retry],
    }));
    endGroup();

    // Get the releases
    startGroup("Getting releases");
    const sourceRelease = await getRelease(sourceOcto, sourceRepo, sourceTag);
    if (sourceRelease === undefined) {
      throw new Error(`Source release ${sourceTag} on ${sourceRepo.owner}/${sourceRepo.repo} does not exist`);
    }
    const destinationTag = maybeDestinationTag ?? sourceRelease.tag_name;
    if (destinationTag !== maybeDestinationTag) {
      info(`Destination tag: ${destinationTag}`);
    }
    // Get the destination release or create it if it doesn't exist
    const destRelease = await getRelease(destOcto, destRepo, destinationTag) ??
      await createRelease(destOcto, destinationTag, destRepo, sourceRelease);
    endGroup();

    // Sync the release assets
    await syncRelease(sourceRelease, destRelease, destOcto, destRepo);
  } catch (error: unknown) {
    console.error("An error occurred:", error);
    if (error instanceof Error) {
      setFailed(error.message);
    } else {
      setFailed(`An unknown error occurred: ${String(error)}`);
    }
  }
}

main().catch((error) => {
  console.error("An error occurred:", error);
  if (error instanceof Error) {
    setFailed(error.message);
  } else {
    setFailed(`An unknown error occurred: ${String(error)}`);
  }
});

type GitHubClient = ReturnType<typeof getOctokit>;
type Release = RestEndpointMethodTypes["repos"]["createRelease"]["response"];
type ReleaseData = Release["data"];

async function createRelease(
  octo: GitHubClient,
  destTag: string,
  destRepo: RepositoryName,
  releaseData: Pick<ReleaseData, "body" | "name" | "draft" | "prerelease" | "assets">
): Promise<ReleaseData> {
  startGroup(`Creating release ${destTag} on ${destRepo.owner}/${destRepo.repo}`);
  try {
    const newRelease = await octo.rest.repos.createRelease(
      {
        body: releaseData.body ?? undefined,
        name: releaseData.name ?? undefined,
        draft: releaseData.draft,
        prerelease: releaseData.prerelease,
        owner: destRepo.owner,
        repo: destRepo.repo,
        tag_name: destTag,
      }
    );
    if (newRelease.status !== 201) {
      throw new Error(`Failed to create release ${destTag} on ${destRepo.owner}/${destRepo.repo}: ${newRelease.data}`);
    }
    endGroup();
    return newRelease.data;
  } catch (error) {
    const msg = `Failed to create release ${destTag} on ${destRepo.owner}/${destRepo.repo}: ${error}`;
    console.error(msg, error);
    endGroup();
    throw new Error(msg);
  }
}

async function getRelease(octo: GitHubClient, repo: RepositoryName, tag: string | "latest"): Promise<ReleaseData | undefined> {
  try {
    info(`Getting release ${tag} on ${repo.owner}/${repo.repo}`);
    const release =
      tag === "latest"
        ? await octo.rest.repos.getLatestRelease({
          owner: repo.owner,
          repo: repo.repo,
        })
        : await octo.rest.repos.getReleaseByTag({
          owner: repo.owner,
          repo: repo.repo,
          tag,
        });

    // If release exists, return it
    if (release.status === 200) {
      info(`Release ${tag} on ${repo.owner}/${repo.repo} found`);
      return release.data;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      // Release does not exist
    } else {
      // Otherwise, rethrow the error
      console.error(error);
      const msg = `Failed to get release ${tag} on ${repo.owner}/${repo.repo}: ${error}`;
      info(msg);
      throw new Error(msg);
    }
  }
  return undefined;
}


async function syncRelease(sourceRelease: ReleaseData, destRelease: ReleaseData, destOcto: GitHubClient, destRepo: RepositoryName) {
  info(`Syncing release ${sourceRelease.tag_name} to ${destRelease.tag_name} on ${destRepo.owner}/${destRepo.repo}`);

  // Create a temporary directory for the download
  const downloadDir = join(tmpdir(), "sync-release", `${sourceRelease.id}-${destRelease.tag_name}`);
  await fs.mkdir(downloadDir, { recursive: true });

  // Sync the assets from the source release to the destination release
  const assetPromises = sourceRelease.assets.map(async (asset) => {
    startGroup(`Syncing asset ${asset.name} to ${destRelease.tag_name} on ${destRepo.owner}/${destRepo.repo}`);

    if (asset.state !== "uploaded") {
      warning(`Asset ${asset.name} is not uploaded, skipping`)
      return;
    }

    // Download the source asset to a temporary file
    info(`Downloading asset ${asset.name} from ${asset.browser_download_url}`);
    const dl = new DownloaderHelper(asset.browser_download_url, downloadDir, { fileName: asset.name })
    dl.on("error", async (dlErr) => {
      throw new Error(`Failed to download ${asset.browser_download_url}: ${dlErr}`)
    })
    await dl.start()

    // Read the file content as a buffer
    info(`Reading file content as a buffer`);
    const fileContent = await fs.readFile(join(downloadDir, asset.name));

    // Upload the asset to the destination release
    info(`Uploading asset ${asset.name} to ${destRelease.tag_name} on ${destRepo.owner}/${destRepo.repo}`);
    await destOcto.rest.repos.uploadReleaseAsset({
      owner: destRepo.owner,
      repo: destRepo.repo,
      release_id: destRelease.id,
      name: asset.name,
      label: asset.label ?? undefined,
      data: fileContent as unknown as string,
      headers: {
        "content-length": asset.size,
        "content-type": asset.content_type ?? "application/octet-stream",
      },
    });
    endGroup();
  });
  await Promise.all(assetPromises);
}
