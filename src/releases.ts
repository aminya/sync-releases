import { endGroup, info, startGroup, warning } from "@actions/core";
import type { getOctokit } from "@actions/github";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import type { RepositoryName } from "./inputs.js";

export type GitHubClient = ReturnType<typeof getOctokit>;
export type Release =
    RestEndpointMethodTypes["repos"]["createRelease"]["response"];
export type ReleaseData = Release["data"];
export type Asset = ReleaseData["assets"][number];

export async function getRelease(
    octo: GitHubClient,
    repo: RepositoryName,
    tag: string | "latest",
): Promise<ReleaseData | undefined> {
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
        if (
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            error.status === 404
        ) {
            // Release does not exist
            info(`Release ${tag} on ${repo.owner}/${repo.repo} does not exist`);
            return undefined;
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

export async function createRelease(
    octo: GitHubClient,
    destTag: string,
    destRepo: RepositoryName,
    releaseData: ReleaseData,
): Promise<ReleaseData> {
    startGroup(
        `Creating release ${destTag} on ${destRepo.owner}/${destRepo.repo}`,
    );
    try {
        const newRelease = await octo.rest.repos.createRelease({
            body: releaseData.body ?? undefined,
            name: releaseData.name ?? undefined,
            draft: releaseData.draft,
            prerelease: releaseData.prerelease,
            owner: destRepo.owner,
            repo: destRepo.repo,
            tag_name: destTag,
        });
        if (newRelease.status !== 201) {
            throw new Error(
                `Failed to create release ${destTag} on ${destRepo.owner}/${destRepo.repo}: ${newRelease.data}`,
            );
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

export async function syncRelease(
    sourceRelease: ReleaseData,
    destRelease: ReleaseData,
    sourceOcto: GitHubClient,
    destOcto: GitHubClient,
    sourceRepo: RepositoryName,
    destRepo: RepositoryName,
    token: string,
) {
    startGroup(
        `Syncing release ${sourceRelease.tag_name} to ${destRelease.tag_name} on ${destRepo.owner}/${destRepo.repo}`,
    );

    // Sync the assets from the source release to the destination release
    const assetPromises = sourceRelease.assets.map(async (asset) => {
        info(
            `Syncing asset ${asset.name} to ${destRelease.tag_name} on ${destRepo.owner}/${destRepo.repo}`,
        );

        if (asset.state !== "uploaded") {
            warning(`Asset ${asset.name} is not uploaded, skipping`);
            return;
        }

        // Download the source asset to a temporary file
        const fileContent = await downloadAsset(asset, sourceRepo, sourceOcto);

        // Upload the asset to the destination release
        await uploadAsset(asset, destRelease, destRepo, destOcto, fileContent);
    });
    await Promise.all(assetPromises);
    endGroup();
}

async function uploadAsset(
    asset: Asset,
    destRelease: ReleaseData,
    destRepo: RepositoryName,
    destOcto: GitHubClient,
    fileContent: Buffer,
) {
    info(
        `Uploading asset ${asset.name} to ${destRelease.tag_name} on ${destRepo.owner}/${destRepo.repo}`,
    );
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
}

async function downloadAsset(
    asset: Asset,
    repo: RepositoryName,
    octo: GitHubClient,
): Promise<Buffer> {
    info(`Downloading asset ${asset.name} from ${asset.browser_download_url}`);

    const response = await octo.rest.repos.getReleaseAsset({
        owner: repo.owner,
        repo: repo.repo,
        asset_id: asset.id,
        headers: {
            accept: "application/octet-stream", // Required for downloading binary files
        },
    });
    if (response.status !== 200) {
        throw new Error(
            `Failed to download asset ${asset.name} from ${asset.browser_download_url}: ${response.data}`,
        );
    }

    return Buffer.from(response.data as unknown as ArrayBuffer);
}
