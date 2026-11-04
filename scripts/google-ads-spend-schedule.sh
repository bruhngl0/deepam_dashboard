#!/usr/bin/env bash
# One-off: an EventBridge schedule that calls the CRM's Google Ads spend sync every hour.
# The app's own timers can run late, because App Runner slows a server down while nobody uses it.
#
#   AWS_PROFILE=<an admin profile> bash scripts/google-ads-spend-schedule.sh
#
# Needs an AWS login allowed to manage EventBridge and IAM (the deploy user is not), and the
# secret deepam-crm/cron-secret, which must also be the service's CRON_SECRET (DEPLOY_AWS.md).
#
# Creates (or updates) in ap-south-1:
#   connection       crm-google-ads-sync        holds "Authorization: Bearer <CRON_SECRET>" (kept by EventBridge
#                                               in Secrets Manager); the secret is never printed
#   api destination  crm-google-ads-sync-run    POST https://wpepwwz4uy.ap-south-1.awsapprunner.com/api/marketing/google-ads-sync
#   role             crm-google-ads-eventbridge may invoke only that destination
#   rule             crm-google-ads-sync-hourly rate(1 hour), no retries (a sync that outlasts EventBridge's
#                                               5-second wait still finishes on the server)
set -euo pipefail
export AWS_REGION=ap-south-1
ACCOUNT=126512878360
URL=https://wpepwwz4uy.ap-south-1.awsapprunner.com/api/marketing/google-ads-sync
CONN=crm-google-ads-sync DEST=crm-google-ads-sync-run ROLE=crm-google-ads-eventbridge RULE=crm-google-ads-sync-hourly

tmp=$(mktemp -d); chmod 700 "$tmp"; trap 'rm -rf "$tmp"' EXIT
TOKEN=$(aws secretsmanager get-secret-value --secret-id deepam-crm/cron-secret --query SecretString --output text)
# The token goes through a private file, never onto a command line.
TOKEN="$TOKEN" CONN="$CONN" node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ Name: process.env.CONN, AuthorizationType: "API_KEY",
  AuthParameters: { ApiKeyAuthParameters: { ApiKeyName: "Authorization", ApiKeyValue: "Bearer " + process.env.TOKEN } } }))' "$tmp/conn.json"
chmod 600 "$tmp/conn.json"; unset TOKEN
if aws events describe-connection --name "$CONN" >/dev/null 2>&1; then
  aws events update-connection --cli-input-json "file://$tmp/conn.json" >/dev/null
else
  aws events create-connection --cli-input-json "file://$tmp/conn.json" >/dev/null
fi
CONN_ARN=$(aws events describe-connection --name "$CONN" --query ConnectionArn --output text)
echo "connection: $CONN"

if aws events describe-api-destination --name "$DEST" >/dev/null 2>&1; then
  aws events update-api-destination --name "$DEST" --connection-arn "$CONN_ARN" --invocation-endpoint "$URL" --http-method POST >/dev/null
else
  aws events create-api-destination --name "$DEST" --connection-arn "$CONN_ARN" --invocation-endpoint "$URL" --http-method POST \
    --invocation-rate-limit-per-second 1 >/dev/null
fi
DEST_ARN=$(aws events describe-api-destination --name "$DEST" --query ApiDestinationArn --output text)
echo "api destination: $DEST -> $URL"

if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --description "EventBridge: call the CRM's Google Ads spend sync" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"events.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  sleep 10 # a new role takes a moment to be usable
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name invoke-google-ads-sync \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"events:InvokeApiDestination\",\"Resource\":\"$DEST_ARN\"}]}"
echo "role: $ROLE (may invoke only $DEST)"

aws events put-rule --name "$RULE" --schedule-expression "rate(1 hour)" --state ENABLED \
  --description "CRM: load Google Ads spend from the Google Ads API every hour" >/dev/null
aws events put-targets --rule "$RULE" --targets "[{\"Id\":\"google-ads-sync\",\"Arn\":\"$DEST_ARN\",\"RoleArn\":\"arn:aws:iam::$ACCOUNT:role/$ROLE\",\"RetryPolicy\":{\"MaximumRetryAttempts\":0,\"MaximumEventAgeInSeconds\":600}}]" \
  --query FailedEntryCount --output text | grep -qx 0
echo "rule: $RULE, every hour. Done."
