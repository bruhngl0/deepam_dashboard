#!/usr/bin/env bash
# Admin access to production RDS through Session Manager. RDS accepts 5432
# only from inside the VPC; this forwards a local port to it via the
# deepam-crm-db-bastion instance, which has no public IP and no inbound rules.
#
#   scripts/db-tunnel.sh [local-port]      # default 5436; Ctrl-C closes it
#
# Then, in another terminal (verify-ca: the certificate names the RDS host,
# not localhost, so verify-full cannot match through a tunnel):
#
#   psql "postgresql://deepam_admin@localhost:5436/deepam_crm?sslmode=verify-ca&sslrootcert=certs/rds-global-bundle.pem"
#
# Needs the AWS CLI and session-manager-plugin. If the bastion is stopped, this
# starts it; stop it afterwards with: aws ec2 stop-instances --instance-ids <id>
set -euo pipefail
export AWS_REGION=ap-south-1
PORT=${1:-5436}
RDS_HOST=deepam-crm-db.cv48qcwoqwja.ap-south-1.rds.amazonaws.com

ID=$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values=deepam-crm-db-bastion Name=instance-state-name,Values=running,stopped,pending \
  --query "Reservations[0].Instances[0].[InstanceId,State.Name]" --output text)
read -r INSTANCE STATE <<<"$ID"
[ "$INSTANCE" != None ] || { echo "No deepam-crm-db-bastion instance found." >&2; exit 1; }

if [ "$STATE" = stopped ]; then
  echo "Starting $INSTANCE..."
  aws ec2 start-instances --instance-ids "$INSTANCE" >/dev/null
fi
until [ "$(aws ssm describe-instance-information --filters Key=InstanceIds,Values="$INSTANCE" \
          --query "InstanceInformationList[0].PingStatus" --output text)" = Online ]; do
  echo "Waiting for $INSTANCE to register with Session Manager..."; sleep 5
done

echo "localhost:$PORT -> $RDS_HOST:5432 (Ctrl-C to close)"
exec aws ssm start-session --target "$INSTANCE" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$RDS_HOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$PORT\"]}"
