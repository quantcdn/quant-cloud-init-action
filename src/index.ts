import * as core from '@actions/core';
import * as exec from '@actions/exec';
import {
    ApplicationsApi,
    EnvironmentsApi,
    Configuration
} from '@quantcdn/quant-client';

interface ApiError {
    response?: {
        status?: number;
        data?: {
            message?: string;
        };
    };
    message?: string;
}

function isProductionBranch(branch: string, masterBranchOverride?: string): boolean {
    const productionBranches = masterBranchOverride ? [masterBranchOverride] : ['main', 'master'];
    return productionBranches.includes(branch);
}

function extractPullRequestId(ref: string): string | null {
    if (ref.startsWith('refs/pull/')) {
        const match = ref.match(/^refs\/pull\/(\d+)\//);
        return match ? match[1] : null;
    }
    return null;
}

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

    if (isTagRef) {
        return 'production';
    }

    if (isPrRef && prId) {
        return `pr-${prId}`;
    }

    if (isProductionBranch(branch, masterBranchOverride)) {
        return 'production';
    } else if (branch === 'develop') {
        return 'develop';
    } else {
        return branch.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    }
}

function generateImageSuffix(
    branch: string,
    masterBranchOverride?: string,
    isTagRef: boolean = false,
    isPrRef: boolean = false,
    prId?: string | null
): string {
    if (isTagRef) {
        return `-${branch}`;
    }

    if (isPrRef && prId) {
        return `-pr-${prId}`;
    }

    if (isProductionBranch(branch, masterBranchOverride)) {
        return '-latest';
    } else if (branch === 'develop') {
        return '-develop';
    } else {
        const safeBranchName = branch.replace(/[^a-zA-Z0-9.]/g, '-').toLowerCase();
        return `-${safeBranchName}`;
    }
}

function stripProtocol(endpoint: string): string {
    return endpoint.replace(/^https?:\/\//, '');
}

async function dockerLogin(endpoint: string, username: string, password: string): Promise<void> {
    try {
        await exec.exec('docker', [
            'login',
            endpoint,
            '--username', username,
            '--password', password
        ], {
            silent: true
        });

        core.info('Docker login successful');
    } catch (error) {
        core.error('Docker login failed');
        throw error;
    }
}

async function run() {
    const apiKey = core.getInput('quant_api_key', { required: true });
    const organization = core.getInput('quant_organization', { required: true });
    const applicationOverride = core.getInput('quant_application', { required: false });
    const masterBranchOverride = core.getInput('master_branch_override', { required: false });
    const environmentNameOverride = core.getInput('environment_name_override', { required: false });
    let baseUrl = core.getInput('base_url', { required: false });

    if (!baseUrl) {
        baseUrl = 'https://dashboard.quantcdn.io';
    } else {
        baseUrl = baseUrl.replace(/\/api\/v3\/?$/, '');
        core.warning(`Using non-default base URL: ${baseUrl}`);
    }

    const githubRef = process.env.GITHUB_REF;
    const githubRepository = process.env.GITHUB_REPOSITORY;

    if (!githubRef || !githubRepository) {
        core.setFailed('GitHub context not available. This action must run in a GitHub Actions workflow.');
        return;
    }

    let branch: string;
    let isTagRef = false;
    let isPr = false;
    let prId: string | null = null;

    if (githubRef.startsWith('refs/tags/')) {
        branch = githubRef.replace('refs/tags/', '');
        isTagRef = true;
    } else if (githubRef.startsWith('refs/pull/')) {
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

    let applicationName: string;
    if (applicationOverride) {
        applicationName = applicationOverride;
    } else {
        applicationName = githubRepository.split('/')[1];
    }

    let isProduction: boolean;
    if (environmentNameOverride) {
        isProduction = isTagRef;
    } else {
        isProduction = isProductionBranch(branch, masterBranchOverride) || isTagRef;
    }

    const environmentName = generateEnvironmentName(branch, environmentNameOverride, masterBranchOverride, isTagRef, isPr, prId);

    let imageSuffix: string;
    if (environmentNameOverride) {
        const safeEnvName = environmentNameOverride.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        imageSuffix = `-${safeEnvName}`;
    } else {
        imageSuffix = generateImageSuffix(branch, masterBranchOverride, isTagRef, isPr, prId);
    }

    const config = new Configuration({
        basePath: baseUrl,
        accessToken: apiKey
    });
    const applicationsClient = new ApplicationsApi(config);
    const environmentsClient = new EnvironmentsApi(config);

    let projectExists = false;
    let environmentExists = false;

    try {
        core.info(`Validating Quant Cloud access...`);

        try {
            await applicationsClient.listApplications(organization);
        } catch (orgError) {
            const errorMessage = orgError instanceof Error ? orgError.message : 'Unknown error';
            core.setFailed(`Organization '${organization}' does not exist or is not accessible: ${errorMessage}`);
            return;
        }

        const registryToken = await applicationsClient.getEcrLoginCredentials(organization);

        if (!registryToken.data || !registryToken.data.password) {
            core.setFailed('No Quant Cloud Image Registry credentials found - organization may not exist or API key may be invalid');
            return;
        }

        try {
            await applicationsClient.getApplication(organization, applicationName);
            projectExists = true;
            core.info(`Application '${applicationName}' exists`);
        } catch (appError) {
            projectExists = false;
            core.info(`Application '${applicationName}' does not exist (will be created on first deployment)`);
        }

        try {
            await environmentsClient.getEnvironment(organization, applicationName, environmentName);
            environmentExists = true;
            core.info(`Environment '${environmentName}' exists`);
        } catch (envError) {
            environmentExists = false;
            core.info(`Environment '${environmentName}' does not exist (will be created on first deployment)`);
        }

    } catch (error) {
        core.error('Organization and API key validation failed');
        if (error instanceof Error) {
            const apiError = error as Error & ApiError;
            if (apiError.response?.data?.message) {
                if (apiError.response.data.message === 'Unable to find matching result') {
                    core.setFailed('Either the organization does not exist or you do not have access to it');
                } else {
                    core.setFailed(apiError.response.data.message);
                }
            } else {
                core.setFailed(error.message);
            }
        } else {
            core.setFailed('An unknown error occurred during validation');
        }
        return;
    }

    try {
        const registryToken = await applicationsClient.getEcrLoginCredentials(organization);

        if (!registryToken.data || !registryToken.data.password) {
            core.setFailed('Failed to retrieve Quant Cloud Image Registry credentials');
            return;
        }

        const endpoint = registryToken.data.endpoint;
        if (!endpoint) {
            core.setFailed('No Quant Cloud Image Registry endpoint found');
            return;
        }
        const strippedEndpoint = stripProtocol(endpoint);

        if (!registryToken.data.username) {
            core.setFailed('No Quant Cloud Image Registry username found');
            return;
        }
        await dockerLogin(endpoint, registryToken.data.username, registryToken.data.password);

        core.setOutput('project_exists', projectExists.toString());
        core.setOutput('environment_exists', environmentExists.toString());
        core.setOutput('quant_application', applicationName);
        core.setOutput('environment_name', environmentName);
        core.setOutput('is_production', isProduction.toString());
        core.setOutput('stripped_endpoint', strippedEndpoint);
        core.setOutput('image_suffix', imageSuffix);
        core.setOutput('image_suffix_clean', imageSuffix.replace(/^-/, ''));

        core.info(`Quant Cloud initialized: ${applicationName}/${environmentName} ${isProduction ? '(production)' : '(non-production)'} ${imageSuffix}`);

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
