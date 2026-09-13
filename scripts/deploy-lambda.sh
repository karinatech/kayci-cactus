#!/usr/bin/env bash
# Packages the Lambda code and deploys it to the live function.
# Requires: AWS CLI configured with permissions for Lambda + S3, node, npm, zip.
# Usage: ./scripts/deploy-lambda.sh [lambda-function-name] [deploy-bucket]
set -euo pipefail

FUNCTION_NAME="${1:-kayci-cactus-api}"
DEPLOY_BUCKET="${2:-kayci-cactus-deploy-061051222996}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ZIP_PATH="$ROOT_DIR/lambda.zip"

echo "==> Installing Lambda dependencies"
(cd "$ROOT_DIR/lambda" && npm install --no-audit --no-fund)

echo "==> Building $ZIP_PATH"
rm -f "$ZIP_PATH"
(cd "$ROOT_DIR/lambda" && zip -qr "$ZIP_PATH" .)

echo "==> Uploading to s3://$DEPLOY_BUCKET/lambda.zip"
aws s3 cp "$ZIP_PATH" "s3://$DEPLOY_BUCKET/lambda.zip"

echo "==> Updating function $FUNCTION_NAME"
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --s3-bucket "$DEPLOY_BUCKET" \
  --s3-key lambda.zip \
  --publish | aws lambda get-function --function-name "$FUNCTION_NAME" --query 'Configuration.LastModified'

echo "==> Done. NOTE:"
echo "    - If this is the FIRST deploy with the media bucket, update the stack first:"
echo "      aws cloudformation deploy --template-file deploy/cloudformation.yaml --stack-name YOUR_STACK --capabilities CAPABILITY_IAM"
echo "    - Verify Google env vars are set on the function (see GOOGLE_CALENDAR.md):"
echo "      GOOGLE_CALENDAR_ID, plus GOOGLE_REFRESH_TOKEN+GOOGLE_CLIENT_ID/SECRET or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY"
