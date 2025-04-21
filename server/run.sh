#!/bin/bash

# Handle Ctrl+C
trap 'echo -e "\nExiting..."; exit 0' SIGINT

while true; do
    bun run src/app.ts
    echo "Process crashed. Restarting in 2 seconds..."
    sleep 2
done
