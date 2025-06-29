import { getInput } from "@actions/core";

export function getRepositoriesNames(): [RepositoryName, RepositoryName] {
  let sourceInput = getInput("source", { required: false });
  let destInput = getInput("destination", { required: false });
  const currentRepo = process.env.GITHUB_REPOSITORY;

  // Validate that either source or destination is provided
  // if only one is provided, check that it's different from the current repository
  if (!sourceInput && !destInput) {
    throw new Error("Either source or destination or both should be provided.");
  } else if (sourceInput === currentRepo && !destInput) {
    throw new Error("Source repository cannot be the same as the current repository when destination is not provided.");
  } else if (destInput === currentRepo && !sourceInput) {
    throw new Error("Destination repository cannot be the same as the current repository when source is not provided.");
  } else if (sourceInput === destInput) {
    throw new Error("Source and destination repositories cannot be the same.");
  } else if (sourceInput && !destInput && currentRepo) {
    destInput = currentRepo;
  } else if (!sourceInput && destInput && currentRepo) {
    sourceInput = currentRepo;
  }

  if (!sourceInput || !destInput) {
    throw new Error("Could not determine source or destination repository.");
  }

  // Validate the source and destination repositories format
  const [sourceRepo, destRepo] = [sourceInput, destInput].map((input) => {
    const repoInfo = parseOwnerRepo(input);
    if (repoInfo === undefined) {
      throw new Error("Invalid repository. Please provide 'source' or 'destination' input in the format 'owner/repo'.");
    }
    return repoInfo;
  });


  return [sourceRepo, destRepo];
}

export type RepositoryName = {
  owner: string;
  repo: string;
};

function parseOwnerRepo(input: string | undefined): RepositoryName | undefined {
  if (!input) {
    return undefined;
  }
  const [owner, repo] = input.split("/");
  return { owner, repo };
}

export function getTagNames(): [string, string | undefined] {
  // Get the tag to sync
  const sourceTagInput = getInput("tag", { required: false }) || process.env.GITHUB_REF;
  const destinationTagInput = getInput("destination-tag", { required: false }) || sourceTagInput;

  const sourceTag = parseTag(sourceTagInput);
  const destinationTag = parseTag(destinationTagInput);

  if (!sourceTag) {
    throw new Error("The provided tag is not valid. Please provide a valid tag or ensure GITHUB_REF is set, or use 'latest' as a default.");
  }

  return [sourceTag, destinationTag];
}

function parseTag(tag: string | undefined): string | undefined {
  if (!tag) {
    return undefined;
  }
  // trim the refs/tags/ prefix if it exists
  return tag.startsWith("refs/tags/") ? tag.substring("refs/tags/".length) : tag;
}

export function getGitHubTokens(): [string, string] {
  const sourceToken = getInput("token", { required: false }) || process.env.GITHUB_TOKEN;
  const destinationToken = getInput("destination-token", { required: false }) || sourceToken;

  if (!sourceToken || !destinationToken) {
    throw new Error("Could not determine source or destination GitHub token.");
  }

  return [sourceToken, destinationToken];
}
