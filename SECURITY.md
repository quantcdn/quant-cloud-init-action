# Security Policy

## Supported Versions

We actively maintain and provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security vulnerability in this GitHub Action, please report it responsibly.

### How to Report

1. **Do not** create a public GitHub issue for security vulnerabilities
2. Email security details to: [security@quantcdn.com](mailto:security@quantcdn.com)
3. Include the following information:
   - Description of the vulnerability
   - Steps to reproduce the issue
   - Potential impact assessment
   - Any suggested fixes or mitigations

### What to Expect

- We will acknowledge receipt of your report within 48 hours
- We will provide regular updates on our progress
- We will work with you to understand and resolve the issue
- We will coordinate the disclosure timeline with you
- We will credit you in our security advisories (unless you prefer to remain anonymous)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution**: Depends on severity and complexity

## Security Best Practices

### For Users of This Action

- Always use the latest version of this action
- Regularly review and update your dependencies
- Use environment variables for sensitive data (API keys, tokens)
- Never commit secrets to your repository
- Review action permissions and use least-privilege access
- Monitor action runs for unexpected behaviour

### For Contributors

- Follow secure coding practices
- Validate all inputs thoroughly
- Use parameterised queries and avoid string concatenation
- Implement proper error handling without exposing sensitive information
- Keep dependencies up to date
- Review all pull requests for security implications

## Dependencies

This action uses the following key dependencies:

- `@actions/core`: GitHub's core action utilities
- `@actions/exec`: GitHub's execution utilities
- `quant-ts-client`: Quant Cloud TypeScript client

We monitor these dependencies for security vulnerabilities and update them regularly.

## Security Updates

Security updates will be:
- Released as patch versions (e.g., 1.0.1, 1.0.2)
- Documented in release notes
- Communicated through GitHub releases
- Backported to supported versions when possible

## Contact

For security-related questions or concerns:
- Email: [security@quantcdn.com](mailto:security@quantcdn.com)
- GitHub Security Advisories: [View advisories](https://github.com/quantcdn/quant-cloud-init-action/security/advisories)

## Acknowledgments

We appreciate the security research community and responsible disclosure practices. Thank you for helping keep our software secure.
