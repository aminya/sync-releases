# Sync Releases Between Repositories

This action syncs releases between two repositories. 

It will create a new release in the destination repository if it doesn't exist, or update an existing release if it does.

## Usage

### Example Workflow

The following workflow will sync the latest release from the source repository to the current repository on tags or workflow dispatch.

```yaml
name: Sync Release

on:
  workflow_dispatch:
    inputs:
      tag:
        description: "Tag to sync"
        required: true
        default: "latest"
  push:
    tags:
      - "*"

# Ensure the action has write permissions to the current repository
permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Copy Release
        uses: aminya/sync-releases@v1
        with:
          source: "source-owner/source-repo"
          destination: "destination-owner/destination-repo"
          token: ${{ secrets.GITHUB_TOKEN }}
          destination-token: ${{ secrets.DESTINATION_GITHUB_TOKEN }}
          tag: ${{ inputs.tag }}
```

### Syncing From Current Repository to Another

```yaml
- name: Sync Releases
  uses: aminya/sync-releases@v1
  with:
    destination: destination-owner/destination-repo
    destination-token: ${{ secrets.DESTINATION_GITHUB_TOKEN }}  
```

### Syncing From Another Repository to Current Repository

```yaml
- name: Sync Releases
  uses: aminya/sync-releases@v1
  with:
    source: source-owner/source-repo
    source-token: ${{ secrets.SOURCE_GITHUB_TOKEN }}
```

Ensure the action has write permissions to the current repository by setting the `permissions` key in the workflow.

```yaml
permissions:
  contents: write
```

### Syncing From One Repository to Another Repository with a Specific Tag and Destination Tag

```yaml
- name: Sync Releases
  uses: aminya/sync-releases@v1
  with:
    source: source-owner/source-repo
    destination: destination-owner/destination-repo
    token: ${{ secrets.SOURCE_GITHUB_TOKEN }}
    destination-token: ${{ secrets.DESTINATION_GITHUB_TOKEN }}
    tag: latest
    destination-tag: synced-latest
```

## Inputs

### `source`

The source owner/repository. Defaults to the current repository if destination is provided.

### `destination`

The destination owner/repository. Defaults to the current repository if source is provided.

### `token`

The token to use to access the source repository. Defaults to GITHUB_TOKEN. Needs read permissions. 

### `destination-token`

The token to use to access the destination repository. Defaults to the source token. Needs write permissions.

### `tag`

The tag to sync from the source repository. Defaults to the triggering tag or the latest tag.

### `destination-tag`

The tag to sync to the destination repository. Defaults to the source tag.

