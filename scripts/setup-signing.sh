#!/bin/bash
# One-time setup: create a stable self-signed code-signing identity in a dedicated
# keychain. Signing OneSwitch.app with this identity gives it a fixed "designated
# requirement" (identifier + cert), so a granted Accessibility/Automation permission
# survives rebuilds (the binary's cdhash changes each build, but the requirement does not).
set -euo pipefail

KEYCHAIN="oneswitch-signing.keychain"          # name form (must carry .keychain suffix)
KEYCHAIN_PASS="oneswitch"
KEYCHAIN_PATH="$HOME/Library/Keychains/oneswitch-signing.keychain-db"  # on-disk file
CERT_CN="OneSwitch Self-Signed"

if [ -f "$KEYCHAIN_PATH" ] && security find-certificate -c "$CERT_CN" "$KEYCHAIN" >/dev/null 2>&1; then
    echo "Signing identity '$CERT_CN' already exists. Nothing to do."
    exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/cert.cnf" <<'EOF'
[ req ]
distinguished_name = dn
x509_extensions    = v3
prompt             = no
[ dn ]
CN = OneSwitch Self-Signed
[ v3 ]
keyUsage           = critical, digitalSignature
extendedKeyUsage   = critical, codeSigning
basicConstraints   = critical, CA:false
EOF

echo "Generating self-signed code-signing certificate…"
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -days 3650 -config "$TMP/cert.cnf" >/dev/null 2>&1
/usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
    -out "$TMP/identity.p12" -passout pass:"$KEYCHAIN_PASS" -name "$CERT_CN" >/dev/null 2>&1

# Dedicated keychain so we never touch the login keychain or its password.
[ -f "$KEYCHAIN_PATH" ] || security create-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN"
security set-keychain-settings "$KEYCHAIN" || true   # disable auto-lock timeout

# Import identity; -A + partition list let codesign use the key with no GUI prompt.
security import "$TMP/identity.p12" -k "$KEYCHAIN" -P "$KEYCHAIN_PASS" -T /usr/bin/codesign -A
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASS" "$KEYCHAIN" >/dev/null 2>&1 || true

# Add our keychain to the user search list, preserving existing entries.
EXISTING=$(security list-keychains -d user | sed 's/[" ]//g' | grep -v "oneswitch-signing" || true)
security list-keychains -d user -s "$KEYCHAIN_PATH" $EXISTING

echo "Done. Identity '$CERT_CN' is ready."
