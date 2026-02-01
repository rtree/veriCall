#!/bin/bash
# ===========================================
# Setup GitHub Secrets from .env.local
# ===========================================
# Usage: ./scripts/setup-github-secrets.sh
#
# Prerequisites:
#   - gh CLI installed and authenticated (gh auth login)
#   - .env.local file exists in project root

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.local"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔐 GitHub Secrets Setup Script"
echo "==============================="
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}❌ gh CLI is not installed${NC}"
    echo "   Install: https://cli.github.com/"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo -e "${RED}❌ gh CLI is not authenticated${NC}"
    echo "   Run: gh auth login"
    exit 1
fi

# Check if .env.local exists
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}❌ .env.local not found at $ENV_FILE${NC}"
    exit 1
fi

# Get repository name
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
if [ -z "$REPO" ]; then
    echo -e "${RED}❌ Could not detect repository${NC}"
    echo "   Make sure you're in a git repository with a GitHub remote"
    exit 1
fi

echo -e "📦 Repository: ${GREEN}$REPO${NC}"
echo ""

# Define which keys to sync as secrets
# (Only sync sensitive production keys, not local-only settings)
SECRETS_TO_SYNC=(
    "TWILIO_ACCOUNT_SID"
    "TWILIO_AUTH_TOKEN"
    "TWILIO_PHONE_NUMBER"
    "DESTINATION_PHONE_NUMBER"
    "FORWARD_TIMEOUT"
    "WHITELIST_NUMBERS"
    "SENDGRID_API_KEY"
    "NOTIFICATION_EMAIL"
    "FROM_EMAIL"
    "VLAYER_API_KEY"
    "VLAYER_CLIENT_ID"
    "VLAYER_WEB_PROVER_URL"
    "VLAYER_ZK_PROVER_URL"
)

echo "📋 Secrets to sync:"
echo ""
for key in "${SECRETS_TO_SYNC[@]}"; do
    value=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)
    if [ -z "$value" ]; then
        echo -e "   ${YELLOW}$key${NC} = (not found)"
    else
        # Show first 4 and last 4 chars, mask the rest
        if [ ${#value} -gt 12 ]; then
            masked="${value:0:4}****${value: -4}"
        else
            masked="****"
        fi
        echo -e "   ${GREEN}$key${NC} = $masked"
    fi
done
echo ""

# Confirm
read -p "Continue? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🚀 Setting secrets..."
echo ""

SUCCESS=0
FAILED=0
SKIPPED=0

for key in "${SECRETS_TO_SYNC[@]}"; do
    # Extract value from .env.local (handle = in values)
    value=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)
    
    if [ -z "$value" ]; then
        echo -e "${YELLOW}⏭️  $key - not found in .env.local, skipping${NC}"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi
    
    # Set the secret
    if echo "$value" | gh secret set "$key" --repo="$REPO"; then
        echo -e "${GREEN}✅ $key${NC}"
        SUCCESS=$((SUCCESS + 1))
    else
        echo -e "${RED}❌ $key - failed to set${NC}"
        FAILED=$((FAILED + 1))
    fi
done

echo ""
echo "==============================="
echo -e "✅ Success: ${GREEN}$SUCCESS${NC}"
echo -e "⏭️  Skipped: ${YELLOW}$SKIPPED${NC}"
echo -e "❌ Failed:  ${RED}$FAILED${NC}"
echo ""

if [ $SUCCESS -gt 0 ]; then
    echo "🎉 Done! Secrets are now available in GitHub Actions."
    echo ""
    echo "Next steps:"
    echo "  1. Commit and push your code"
    echo "  2. GitHub Actions will use these secrets for deployment"
fi
