#!/bin/sh
set -e

echo "[entrypoint] waiting for mysql at ${DB_HOST}..."
until php -r 'exit((new mysqli(getenv("DB_HOST"), getenv("DB_USERNAME"), getenv("DB_PASSWORD"), getenv("DB_DATABASE")))->connect_errno ? 1 : 0);' 2>/dev/null; do
  sleep 1
done
echo "[entrypoint] mysql ready"

cat > /var/www/html/.env <<EOF
DB_HOST="${DB_HOST}"
DB_USERNAME="${DB_USERNAME}"
DB_PASSWORD="${DB_PASSWORD}"
DB_DATABASE="${DB_DATABASE}"
SMTP_HOST="${SMTP_HOST}"
SMTP_PORT="${SMTP_PORT}"
SMTP_USERNAME="${SMTP_USERNAME}"
SMTP_PASSWORD="${SMTP_PASSWORD}"
SMTP_ENCRYPTION="${SMTP_ENCRYPTION}"
SENDER_EMAIL="${SENDER_EMAIL}"
SENDER_NAME="${SENDER_NAME}"
DEMO="${DEMO}"
EOF

if [ ! -f /var/www/html/vendor/autoload.php ]; then
  echo "[entrypoint] installing composer dependencies"
  cd /var/www/html && composer install --no-interaction --no-progress --prefer-dist
fi

TABLE_COUNT=$(php -r '
  $c = new mysqli(getenv("DB_HOST"), getenv("DB_USERNAME"), getenv("DB_PASSWORD"), getenv("DB_DATABASE"));
  if ($c->connect_errno) { echo 0; exit; }
  $r = $c->query("SHOW TABLES");
  echo $r ? $r->num_rows : 0;
')

if [ "${MV_RESET}" = "1" ]; then
  echo "[entrypoint] MV_RESET=1: dropping all tables and re-applying schema"
  php /var/www/html/database/install.php --reset
elif [ "${TABLE_COUNT}" = "0" ]; then
  echo "[entrypoint] empty database: applying schema"
  php /var/www/html/database/install.php
else
  echo "[entrypoint] database has ${TABLE_COUNT} table(s); skipping schema"
fi

chown -R www-data:www-data /var/www/html/uploads 2>/dev/null || true
chmod 775 /var/www/html/uploads 2>/dev/null || true
find /var/www/html/uploads -type d -exec chmod 775 {} + 2>/dev/null || true

exec apache2-foreground
