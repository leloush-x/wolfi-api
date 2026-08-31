#!/bin/bash
set -e

echo "Cleaning dist..."
rm -rf dist

echo "Building frontend..."
bun x vite build --config client/vite.config.ts

echo "Staging dist..."
git add dist/

echo "Committing..."
git commit -m "chore: rebuild dist $(date +%Y-%m-%d_%H:%M)" || echo "Nothing to commit"

echo "Pushing..."
git push

echo "Done."
