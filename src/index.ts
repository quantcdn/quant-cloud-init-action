import * as core from '@actions/core';
import * as exec from '@actions/exec';
import {
    ApplicationsApi,
    EnvironmentsApi,
    Configuration
} from '@quantcdn/quant-client';

interface ApiError {
    body?: {
        message?: string;
    }
}

const createConfig = (apiKey: string, baseUrl: string) => {
    return new Configuration({
        basePath: baseUrl,
        accessToken: apiKey
    });
}

/**
 * Determine if the current branch is a production branch
 */
function isProductionBranch(branch: string, masterBranchOverride?: string): boolean {
    const productionBranches = masterBranchOverride ? [masterBranchOverride] : ['main', 'master'];
    return productionBranches.includes(branch);
}

/**
 * Determine if the current ref is a tag
 */
function isTag(ref: string): boolean {
    return ref.startsWith('refs/tags/');
}

/**
 * Determine if the current ref is a pull request
 */
function isPullRequest(ref: string): boolean {
    return ref.startsWith('refs/pull/');
}

/**
 * Extract pull request ID from ref
 */
function extractPullRequestId(ref: string): string | null {
    if (ref.startsWith('refs/pull/')) {
        // refs/pull/123/merge -> 123
        const match = ref.match(/^refs\/pull\/(\d+)\//);
        return match ? match[1] : null;
    }
    return null;
}

/**
 * Generate environment name based on branch and overrides
 */
function generateEnvironmentName(
    branch: string,
    environmentNameOverride?: string,
    masterBranchOverride?: string,
    isTagRef: boolean = false,
    isPrRef: boolean = false,
    prId?: string | null
): string {
    if (environmentNameOverride) {
        return environmentNameOverride;
    }

    // Tags are always production
    if (isTagRef) {
        return 'production';
    }

    // Pull requests get unique PR environments
    if (isPrRef && prId) {
        return `pr-${prId}`;
    }

    if (isProductionBranch(branch, masterBranchOverride)) {
        return 'production';
    } else if (branch === 'develop') {
        return 'develop';
    } else if (branch.startsWith('feature/')) {
        // For feature branches, use the full branch name to create unique environments
        return branch.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    } else {
        // For other branches, use the branch name
        return branch.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    }
}

/**
 * Generate image tag suffix based on branch
 */
function generateImageSuffix(
    branch: string,
    masterBranchOverride?: string,
    isTagRef: boolean = false,
    isPrRef: boolean = false,
    prId?: string | null
): string {
    // Tags get their tag name as suffix
    if (isTagRef) {
        return `-${branch}`;
    }

    // Pull requests get unique PR suffixes
    if (isPrRef && prId) {
        return `-pr-${prId}`;
    }

    if (isProductionBranch(branch, masterBranchOverride)) {
        return '-latest';
    } else if (branch === 'develop') {
        return '-develop';
    } else if (branch.startsWith('feature/')) {
        const safeBranchName = branch.replace(/[^a-zA-Z0-9.]/g, '-').toLowerCase();
        return `-${safeBranchName}`;
    } else {
        const safeBranchName = branch.replace(/[^a-zA-Z0-9.]/g, '-').toLowerCase();
        return `-${safeBranchName}`;
    }
}

/**
 * Strip protocol from Quant Cloud Image Registry endpoint
 */
function stripProtocol(endpoint: string): string {
    return endpoint.replace(/^https?:\/\//, '');
}

/**
 * Login to Docker registry using Quant Cloud Image Registry credentials
 */
async function dockerLogin(endpoint: string, username: string, password: string): Promise<void> {
    try {
        // Use docker login command with silent output to hide credentials
        await exec.exec('docker', [
            'login',
            endpoint,
            '--username', username,
            '--password', password
        ], {
            silent: true
        });

        core.info('✅ Docker login successful');
    } catch (error) {
        core.error('❌ Docker login failed');
        throw error;
    }
}

/**
 * The main function for the action.
 * @returns {Promise<void>}
 */
async function run() {
    const apiKey = core.getInput('quant_api_key', { required: true });
    const organization = core.getInput('quant_organization', { required: true });
    const applicationOverride = core.getInput('quant_application', { required: false });
    const masterBranchOverride = core.getInput('master_branch_override', { required: false });
    const environmentNameOverride = core.getInput('environment_name_override', { required: false });
    let baseUrl = core.getInput('base_url', { required: false });

    if (!baseUrl) {
        baseUrl = 'https://dashboard.quantcdn.io/api/v3';
    } else {
        core.warning(`Using non-default base URL: ${baseUrl}`);
    }

    // Get GitHub context
    const githubRef = process.env.GITHUB_REF;
    const githubRepository = process.env.GITHUB_REPOSITORY;
    const githubEventName = process.env.GITHUB_EVENT_NAME;


    if (!githubRef || !githubRepository) {
        core.setFailed('GitHub context not available. This action must run in a GitHub Actions workflow.');
        return;
    }

    // Determine branch, tag, or pull request
    let branch: string;
    let isTag = false;
    let isPr = false;
    let prId: string | null = null;

    if (githubRef.startsWith('refs/tags/')) {
        branch = githubRef.replace('refs/tags/', '');
        isTag = true;
    } else if (githubRef.startsWith('refs/pull/')) {
        // For pull requests, extract the PR ID and use a placeholder branch name
        prId = extractPullRequestId(githubRef);
        if (!prId) {
            core.setFailed(`Could not extract pull request ID from ref: ${githubRef}`);
            return;
        }
        branch = `pr-${prId}`;
        isPr = true;
    } else if (githubRef.startsWith('refs/heads/')) {
        branch = githubRef.replace('refs/heads/', '');
    } else {
        core.setFailed(`Unknown ref format: ${githubRef}`);
        return;
    }

    // Determine application name
    let applicationName: string;
    if (applicationOverride) {
        applicationName = applicationOverride;
    } else {
        // Extract repository name from GITHUB_REPOSITORY (e.g., "salsadigitalauorg/civicthemeio" -> "civicthemeio")
        applicationName = githubRepository.split('/')[1];
    }

    // Determine environment and production status
    // If environment is overridden, don't use branch-based production detection
    let isProduction: boolean;
    if (environmentNameOverride) {
        // When environment is overridden, only consider tags as production
        isProduction = isTag;
    } else {
        // Use normal branch-based production detection
        isProduction = isProductionBranch(branch, masterBranchOverride) || isTag;
    }

    const environmentName = generateEnvironmentName(branch, environmentNameOverride, masterBranchOverride, isTag, isPr, prId);

    // Generate image suffix - if environment is overridden, use it for the suffix
    let imageSuffix: string;
    if (environmentNameOverride) {
        // When environment is overridden, generate suffix based on the environment name
        // Environment names must be Quant Cloud compliant (no dots), but image suffixes can have dots
        const safeEnvName = environmentNameOverride.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        imageSuffix = `-${safeEnvName}`;
    } else {
        // Use normal branch-based suffix generation
        imageSuffix = generateImageSuffix(branch, masterBranchOverride, isTag, isPr, prId);
    }

    // For tags, we need to extract the tag name from the ref
    const tagName = isTag ? branch : null;


    // Initialize API clients with configuration
    const config = createConfig(apiKey, baseUrl);
    const applicationsClient = new ApplicationsApi(config);
    const environmentsClient = new EnvironmentsApi(config);

    // Validate organization and API key by checking if project exists
    let projectExists = false;
    let environmentExists = false;

    try {
        core.info(`🔍 Validating Quant Cloud access...`);

        // First, check if the organization exists by trying to list applications
        try {
            const applications = await applicationsClient.listApplications(organization);
        } catch (orgError: any) {
            const errorMessage = orgError instanceof Error ? orgError.message : 'Unknown error';
            // Fail on any error, including 404, as the mock API is now fixed for this endpoint
            core.setFailed(`Organization '${organization}' does not exist or is not accessible: ${errorMessage}`);
            return;
        }

        // Try to get Quant Cloud Image Registry credentials as a validation step
        try {
            const registryToken = await applicationsClient.getEcrLoginCredentials(organization);

            if (!registryToken.data || !registryToken.data.password) {
                core.warning('No Quant Cloud Image Registry credentials found during validation');
            }
        } catch (ecrError: any) {
            const errorMessage = ecrError instanceof Error ? ecrError.message : 'Unknown error';
            const status = ecrError.response?.status;

            if (status === 422 || status === 401 || status === 403) {
                core.setFailed(`Failed to validate organization credentials: ${errorMessage}`);
                return;
            } else {
                core.warning(`Could not retrieve ECR credentials during validation: ${errorMessage}`);
            }
        }

        // Now check if the specific application exists
        try {
            const application = await applicationsClient.getApplication(organization, applicationName);
            projectExists = true;
            core.info(`✅ Application '${applicationName}' exists`);
        } catch (appError: any) {
            const status = appError.response?.status;

            if (status === 422 || status === 401 || status === 403) {
                const errorMessage = appError instanceof Error ? appError.message : 'Unknown error';
                core.setFailed(`Failed to validate application: ${errorMessage}`);
                return;
            }

            projectExists = false;
            core.info(`ℹ️ Application '${applicationName}' does not exist (will be created on first deployment)`);
        }

        // Check if environment exists using EnvironmentsApi
        try {
            const environment = await environmentsClient.getEnvironment(organization, applicationName, environmentName);
            environmentExists = true;
            core.info(`✅ Environment '${environmentName}' exists`);
        } catch (envError) {
            environmentExists = false;
            core.info(`ℹ️ Environment '${environmentName}' does not exist (will be created on first deployment)`);
        }

    } catch (error) {
        core.error('❌ Organization and API key validation failed');
        if (error instanceof Error) {
            const apiError = error as Error & ApiError;
            if (apiError.body?.message) {
                if (apiError.body.message === 'Unable to find matching result') {
                    core.setFailed('Either the organization does not exist or you do not have access to it');
                } else {
                    core.setFailed(apiError.body.message);
                }
            } else {
                core.setFailed(error.message);
            }
        } else {
            core.setFailed('An unknown error occurred during validation');
        }
        return;
    }

    // Get Quant Cloud Image Registry credentials and login to Docker
    try {
        let endpoint = '';
        let username = '';
        let password = '';
        let hasCredentials = false;

        try {
            const registryToken = await applicationsClient.getEcrLoginCredentials(organization);
            if (registryToken.data && registryToken.data.password && registryToken.data.endpoint && registryToken.data.username) {
                endpoint = registryToken.data.endpoint;
                username = registryToken.data.username;
                password = registryToken.data.password;
                hasCredentials = true;
            }
        } catch (error) {
            core.warning(`Failed to retrieve Quant Cloud Image Registry credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        const skipDockerLogin = core.getInput('skip_docker_login') === 'true';

        if (hasCredentials) {
            const strippedEndpoint = stripProtocol(endpoint);

            // Login to Docker registry
            if (skipDockerLogin) {
                core.info('⚠️ Skipping Docker login as requested');
            } else {
                await dockerLogin(endpoint, username, password);
            }

            core.setOutput('stripped_endpoint', strippedEndpoint);
        } else {
            if (skipDockerLogin) {
                core.info('⚠️ Skipping Docker login as requested (and no credentials available)');
            } else {
                core.setFailed('Failed to retrieve Quant Cloud Image Registry credentials and login was not skipped');
                return;
            }
        }

        // Set outputs
        core.setOutput('project_exists', projectExists.toString());
        core.setOutput('environment_exists', environmentExists.toString());
        core.setOutput('quant_application', applicationName);
        core.setOutput('environment_name', environmentName);
        core.setOutput('is_production', isProduction.toString());
        core.setOutput('image_suffix', imageSuffix);
        core.setOutput('image_suffix_clean', imageSuffix.replace(/^-/, ''));

        // Log summary
        core.info(`✅ Quant Cloud initialized: ${applicationName}/${environmentName} ${isProduction ? '(production)' : '(non-production)'} ${imageSuffix}`);

    } catch (error) {
        core.error('Failed to complete initialization');
        if (error instanceof Error) {
            core.setFailed(error.message);
        } else {
            core.setFailed('An unknown error occurred during initialization');
        }
    }
}

run();