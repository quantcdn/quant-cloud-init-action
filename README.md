# Quant Cloud Init Action

A GitHub Action for initializing Quant Cloud deployments with environment detection, Quant Cloud Image Registry setup, validation, and **automatic Docker login**.

## Features

- **Automatic Environment Detection**: Automatically determines environment names based on branch names
- **Registry Authentication**: Handles Quant Cloud Image Registry login and **automatically logs into Docker registry**
- **Comprehensive Validation**: Validates organization, API key, and application existence in Quant Cloud
- **Smart Branch Handling**: Supports main/master, develop, feature branches, and tags
- **Flexible Configuration**: Allows overrides for application names, master branches, and environment names
- **Seamless Integration**: No need for separate Docker login steps in your workflow

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `quant_organization` | Yes | Quant Cloud organisation name |
| `quant_api_key` | Yes | Quant Cloud API key |
| `quant_application` | No | Quant Cloud application name (defaults to repository name) |
| `master_branch_override` | No | Override for master branch name (defaults to "main" or "master") |
| `environment_name_override` | No | Override for environment name |
| `base_url` | No | Quant Cloud API base URL (defaults to production) |

## Outputs

| Output | Description |
|--------|-------------|
| `project_exists` | Whether the project exists in Quant Cloud |
| `environment_exists` | Whether the environment exists in Quant Cloud |
| `quant_application` | The determined application name |
| `environment_name` | The determined environment name |
| `is_production` | Whether this is a production environment |
| `stripped_endpoint` | Quant Cloud Image Registry endpoint without protocol (for Docker tags) |
| `image_suffix` | The determined image tag suffix (e.g., -latest, -develop, -v1.0.0) |

> **Note**: Registry credentials (username, password, endpoint) are no longer exposed as outputs since Docker login is handled automatically.

## Image Tagging with `image_suffix`

The `image_suffix` output provides the appropriate tag suffix for Docker images based on your branch or tag:

- **main/master branches**: `-latest` (e.g., `myapp:latest`)
- **develop branch**: `-develop` (e.g., `myapp:develop`)  
- **feature branches**: `-{branch-name}` (e.g., `myapp:feature-new-feature`)
- **tags**: `-tag-name` (e.g., `myapp:v1.0.0`)

### Usage Example
```yaml
- name: Build and push image
  uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: ${{ steps.init.outputs.stripped_endpoint }}/${{ secrets.QUANT_ORGANIZATION }}/${{ steps.init.outputs.quant_application }}${{ steps.init.outputs.image_suffix }}
```

This automatically creates the correct image tag based on your current branch or tag!

## Environment Detection Logic

The action automatically determines the environment based on the current branch:

- **main/master branches**: `production` environment with `-latest` image suffix
- **develop branch**: `develop` environment with `-develop` image suffix  
- **feature branches**: `{branch-name}` environment with `-{branch-name}` image suffix
- **tags**: `production` environment with `-{tag-name}` image suffix
- **other branches**: `{branch-name}` environment with `-{branch-name}` image suffix

## Usage

### Basic Usage

```yaml
- name: Initialize Quant Cloud
  uses: your-org/quant-cloud-init-action@v1
  id: init
  with:
    quant_organization: ${{ secrets.QUANT_ORGANIZATION }}
    quant_api_key: ${{ secrets.QUANT_API_KEY }}

- name: Build and push image
  uses: docker/build-push-action@v5
  with:
    context: .
    push: true
              tags: ${{ steps.init.outputs.stripped_endpoint }}/${{ secrets.QUANT_ORGANIZATION }}/${{ steps.init.outputs.quant_application }}${{ steps.init.outputs.image_suffix }}
```

### With Custom Application Name

```yaml
- name: Initialize Quant Cloud
  uses: your-org/quant-cloud-init-action@v1
  id: init
  with:
    quant_organization: ${{ secrets.QUANT_ORGANIZATION }}
    quant_api_key: ${{ secrets.QUANT_API_KEY }}
    quant_application: my-custom-app-name
```

### With Custom Master Branch

```yaml
- name: Initialize Quant Cloud
  uses: your-org/quant-cloud-init-action@v1
  id: init
  with:
    quant_organization: ${{ secrets.QUANT_ORGANIZATION }}
    quant_api_key: ${{ secrets.QUANT_API_KEY }}
    master_branch_override: main
```

### Complete Pipeline Example

```yaml
name: Build and Deploy to Quant Cloud
on:
  push:
    branches: [main, develop, feature/*]
    tags: ['*']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        
      - name: Initialize Quant Cloud (includes Docker login!)
        uses: your-org/quant-cloud-init-action@v1
        id: init
        with:
          quant_organization: ${{ secrets.QUANT_ORGANIZATION }}
          quant_api_key: ${{ secrets.QUANT_API_KEY }}
          
      - name: Build and push CLI image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./.docker/Dockerfile.cli
          platforms: linux/arm64
          push: true
          tags: ${{ steps.init.outputs.stripped_endpoint }}/${{ secrets.QUANT_ORGANIZATION }}/${{ steps.init.outputs.quant_application }}:cli${{ steps.init.outputs.image_suffix }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          
      - name: Build and push PHP image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./.docker/Dockerfile.php
          platforms: linux/arm64
          push: true
          tags: ${{ steps.init.outputs.stripped_endpoint }}/${{ secrets.QUANT_ORGANIZATION }}/${{ steps.init.outputs.quant_application }}:php${{ steps.init.outputs.image_suffix }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          
      - name: Redeploy environment
        uses: quantcdn/quant-cloud-environment-state-action@v1
        with:
          api_key: ${{ secrets.QUANT_API_KEY }}
          organization: ${{ secrets.QUANT_ORGANIZATION }}
          application: ${{ steps.init.outputs.quant_application }}
          environment: ${{ steps.init.outputs.environment_name }}
          action: redeploy
          
      - name: Show deployment summary
        run: |
          echo "🎉 Deployment completed successfully!"
          echo "Application: ${{ steps.init.outputs.quant_application }}"
          echo "Environment: ${{ steps.init.outputs.environment_name }}"
          echo "Production: ${{ steps.init.outputs.is_production }}"
          echo "Registry Endpoint: ${{ steps.init.outputs.stripped_endpoint }}"
          echo "Image Suffix: ${{ steps.init.outputs.image_suffix }}"
```

## Error Handling

The action will fail early if:
- The organization doesn't exist
- The API key is invalid
- GitHub context is not available
- Quant Cloud Image Registry credentials cannot be retrieved
- Docker login fails

## Development

### Building

```bash
npm install
npm run build
```

### Testing

```bash
npm test
```

## License

This project is licensed under the MIT License. 