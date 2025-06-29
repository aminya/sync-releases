import { endGroup, info, setFailed, startGroup } from "@actions/core";
import { getOctokit } from "@actions/github";
import { retry } from "@octokit/plugin-retry";
import {
    getGitHubTokens,
    getRepositoriesNames,
    getTagNames,
} from "./inputs.js";
import { createRelease, getRelease, syncRelease } from "./releases.js";

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
        const [sourceOcto, destOcto] = tokens.map((token) =>
            getOctokit(token, {
                plugins: [retry],
            }),
        );
        endGroup();

        // Get the releases
        startGroup("Getting releases");
        const sourceRelease = await getRelease(
            sourceOcto,
            sourceRepo,
            sourceTag,
        );
        if (sourceRelease === undefined) {
            throw new Error(
                `Source release ${sourceTag} on ${sourceRepo.owner}/${sourceRepo.repo} does not exist`,
            );
        }
        const destinationTag = maybeDestinationTag ?? sourceRelease.tag_name;
        if (destinationTag !== maybeDestinationTag) {
            info(`Destination tag: ${destinationTag}`);
        }
        // Get the destination release or create it if it doesn't exist
        const destRelease =
            (await getRelease(destOcto, destRepo, destinationTag)) ??
            (await createRelease(
                destOcto,
                destinationTag,
                destRepo,
                sourceRelease,
            ));
        endGroup();

        // Sync the release assets
        await syncRelease(
            sourceRelease,
            destRelease,
            destOcto,
            destRepo,
            tokens[0],
        );
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
