[build]
dockerfilePath = "apps/api/Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 60
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
