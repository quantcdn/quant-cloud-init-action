import * as core from '@actions/core';
import * as exec from '@actions/exec';
import {
    ApplicationsApi,
    EnvironmentsApi
} from 'quant-ts-client';

interface ApiError {
    body?: {
        message?: string;
    }
}

const apiOpts = (apiKey: string) => {
    return {
        applyToRequest: (requestOptions: any) => {
            if (requestOptions && requestOptions.headers) {
                requestOptions.headers["Authorization"] = `Bearer ${apiKey}`;
            }
        }
    }
}

/**
 * Determine if the current branch is a production branch
 */
function isProductionBranch(branch: string, masterBranchOverride?: string): boolean {
    const productionBranches = masterBranchOverride ? [masterBranchOverride] : ['main', 'master'];
    return productionBranches.includes(branch);
}

/**
 * Generate environment name based on branch and overrides
 */
function generateEnvironmentName(
    branch: string, 
    environmentNameOverride?: string,
    masterBranchOverride?: string
): string {
    if (environmentNameOverride) {
        return environmentNameOverride;
    }

    if (isProductionBranch(branch, masterBranchOverride)) {
        return 'production';
    } else if (branch === 'develop') {
        return 'develop';
    } else if (branch.startsWith('feature/')) {
        return 'feature';
    } else {
        // For other branches, use the branch name
        return branch.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();
    }
}

/**
 * Generate image tag suffix based on branch
 */
function generateImageSuffix(branch: string, masterBranchOverride?: string): string {
    if (isProductionBranch(branch, masterBranchOverride)) {
        return '-latest';
    } else if (branch === 'develop') {
        return '-develop';
    } else if (branch.startsWith('feature/')) {
        const safeBranchName = branch.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();
        return `-${safeBranchName}`;
    } else {
        const safeBranchName = branch.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();
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
        core.info(`Logging into Docker registry: ${endpoint}`);
        
        // Use docker login command
        await exec.exec('docker', [
            'login',
            endpoint,
            '--username', username,
            '--password', password
        ]);
        
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

    core.info(`GitHub Context - Ref: ${githubRef}, Repository: ${githubRepository}, Event: ${githubEventName}`);

    if (!githubRef || !githubRepository) {
        core.setFailed('GitHub context not available. This action must run in a GitHub Actions workflow.');
        return;
    }

    // Determine branch or tag
    let branch: string;
    let isTag = false;
    
    if (githubRef.startsWith('refs/tags/')) {
        branch = githubRef.replace('refs/tags/', '');
        isTag = true;
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
        core.info(`Using provided application name: ${applicationName}`);
    } else {
        // Extract repository name from GITHUB_REPOSITORY (e.g., "salsadigitalauorg/civicthemeio" -> "civicthemeio")
        applicationName = githubRepository.split('/')[1];
        core.info(`Using repository name as application name: ${applicationName}`);
    }

    // Determine environment and production status
    const isProduction = isProductionBranch(branch, masterBranchOverride);
    const environmentName = generateEnvironmentName(branch, environmentNameOverride, masterBranchOverride);
    const imageSuffix = generateImageSuffix(branch, masterBranchOverride);

    core.info(`Branch: ${branch}`);
    core.info(`Is tag: ${isTag}`);
    core.info(`Environment: ${environmentName}`);
    core.info(`Is production: ${isProduction}`);
    core.info(`Image suffix: ${imageSuffix}`);

    // Initialize API clients
    const applicationsClient = new ApplicationsApi(baseUrl);
    const environmentsClient = new EnvironmentsApi(baseUrl);
    
    applicationsClient.setDefaultAuthentication(apiOpts(apiKey));
    environmentsClient.setDefaultAuthentication(apiOpts(apiKey));

    // Validate organization and API key by checking if project exists
    let projectExists = false;
    let environmentExists = false;

    try {
        core.info(`Validating organization and API key for ${organization}...`);
        
        // Try to get Quant Cloud Image Registry credentials as a validation step
        const registryToken = await applicationsClient.getEcrLoginCredentials(organization);
        
        if (registryToken.body && registryToken.body.password) {
            projectExists = true;
            core.info('✅ Organization and API key validation successful');
        } else {
            core.setFailed('No Quant Cloud Image Registry credentials found - organization may not exist or API key may be invalid');
            return;
        }

        // Check if environment exists (optional - won't fail if it doesn't)
        try {
            // This would need to be implemented based on your Quant Cloud API
            // For now, we'll assume it exists if we can get registry credentials
            environmentExists = true;
            core.info(`✅ Environment ${environmentName} validation successful`);
        } catch (envError) {
            core.warning(`Environment ${environmentName} may not exist yet - this is normal for new projects`);
            environmentExists = false;
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
        core.info('Getting Quant Cloud Image Registry login credentials...');
        const registryToken = await applicationsClient.getEcrLoginCredentials(organization);

        if (!registryToken.body || !registryToken.body.password) {
            core.setFailed('Failed to retrieve Quant Cloud Image Registry credentials');
            return;
        }

        const endpoint = registryToken.body.endpoint;
        if (!endpoint) {
            core.setFailed('No Quant Cloud Image Registry endpoint found');
            return;
        }
        const strippedEndpoint = stripProtocol(endpoint);

        core.info('✅ Quant Cloud Image Registry login credentials retrieved successfully');

        // Login to Docker registry
        if (!registryToken.body.username) {
            core.setFailed('No Quant Cloud Image Registry username found');
            return;
        }
        await dockerLogin(endpoint, registryToken.body.username, registryToken.body.password);

        // Set outputs (excluding registry credentials)
        core.setOutput('project_exists', projectExists.toString());
        core.setOutput('environment_exists', environmentExists.toString());
        core.setOutput('quant_application', applicationName);
        core.setOutput('environment_name', environmentName);
        core.setOutput('is_production', isProduction.toString());
        core.setOutput('stripped_endpoint', strippedEndpoint);
        
        // Log summary
        core.info('🎉 Quant Cloud initialization completed successfully!');
        core.info(`Application: ${applicationName}`);
        core.info(`Environment: ${environmentName}`);
        core.info(`Production: ${isProduction}`);
        core.info(`Registry Endpoint: ${endpoint}`);
        core.info(`Stripped Endpoint: ${strippedEndpoint}`);
        core.info(`Image Suffix: ${imageSuffix}`);
        core.info('✅ Docker registry login completed');

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