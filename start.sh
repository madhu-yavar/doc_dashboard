#!/bin/bash

# Load .env if it exists
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Start backend and frontend in background
echo "Starting backend on port 8001..."
npm run server &

echo "Starting frontend dev server..."
npm run dev &

wait
