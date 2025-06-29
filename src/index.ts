import { setFailed, setOutput, warning } from "@actions/core";
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
    const [sourceRepo, destRepo] = getRepositoriesNames();
    const [sourceTag, maybeDestinationTag] = getTagNames();
    const tokens = getGitHubTokens();

    // Initialize the GitHub clients
    const [sourceOcto, destOcto] = tokens.map((token) => getOctokit(token, {
      plugins: [retry],
    }));

    // Get the releases
    const sourceRelease = await getRelease(sourceOcto, sourceRepo, sourceTag);
    if (sourceRelease === undefined) {
      throw new Error(`Source release ${sourceTag} on ${sourceRepo.owner}/${sourceRepo.repo} does not exist`);
    }
    const destinationTag = maybeDestinationTag || sourceRelease.tag_name;

    // Get the destination release or create it if it doesn't exist
    const destRelease = await getRelease(destOcto, destRepo, destinationTag) ??
      await createRelease(destOcto, destinationTag, destRepo, sourceRelease);

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
    return newRelease.data;
  } catch (error) {
    throw new Error(`Failed to create release ${destTag} on ${destRepo.owner}/${destRepo.repo}: ${error}`);
  }
}

async function getRelease(octo: GitHubClient, repo: RepositoryName, tag: string): Promise<ReleaseData | undefined> {
  try {
    // check if release exists
    const release = await octo.rest.repos.getReleaseByTag({
      owner: repo.owner,
      repo: repo.repo,
      tag: tag,
    });
    // If release exists, return it
    if (release.status === 200) {
      return release.data;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      // Release does not exist
    } else {
      // Otherwise, rethrow the error
      throw new Error(`Failed to get release ${tag} on ${repo.owner}/${repo.repo}: ${error}`);
    }
  }
  return undefined;
}


async function syncRelease(sourceRelease: ReleaseData, destRelease: ReleaseData, destOcto: GitHubClient, destRepo: RepositoryName) {
  // Create a temporary directory for the download
  const downloadDir = join(tmpdir(), "sync-release", `${sourceRelease.id}-${destRelease.tag_name}`);
  await fs.mkdir(downloadDir, { recursive: true });

  // Sync the assets from the source release to the destination release
  const assetPromises = sourceRelease.assets.map(async (asset) => {
    if (asset.state !== "uploaded") {
      warning(`Asset ${asset.name} is not uploaded, skipping`)
      return;
    }

    // Download the source asset to a temporary file
    const dl = new DownloaderHelper(asset.browser_download_url, downloadDir, { fileName: asset.name })
    dl.on("error", async (dlErr) => {
      throw new Error(`Failed to download ${asset.browser_download_url}: ${dlErr}`)
    })
    await dl.start()

    // Read the file content as a buffer
    const fileContent = await fs.readFile(join(downloadDir, asset.name));

    // Upload the asset to the destination release
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
  });
  await Promise.all(assetPromises);
}
