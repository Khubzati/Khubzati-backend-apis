#!/bin/bash

# Base URL
BASE_URL="http://localhost:3000"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "Testing Todos Endpoints..."

# Test 1: Get all todos (public access)
echo -e "\n${GREEN}Test 1: Get all todos${NC}"
curl -X GET "${BASE_URL}/api/todos" -v

# Test 2: Create a new todo (requires auth)
echo -e "\n\n${GREEN}Test 2: Create a new todo${NC}"
curl -X POST "${BASE_URL}/api/todos" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Todo",
    "completed": false
  }' -v

# Test 3: Get a specific todo (public access)
echo -e "\n\n${GREEN}Test 3: Get a specific todo${NC}"
curl -X GET "${BASE_URL}/api/todos/123" -v

# Test 4: Update a todo (requires auth)
echo -e "\n\n${GREEN}Test 4: Update a todo${NC}"
curl -X PUT "${BASE_URL}/api/todos/123" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Todo",
    "completed": true
  }' -v

# Test 5: Delete a todo (requires auth)
echo -e "\n\n${GREEN}Test 5: Delete a todo${NC}"
curl -X DELETE "${BASE_URL}/api/todos/123" -v

# Test 6: Verify deletion
echo -e "\n\n${GREEN}Test 6: Verify deletion${NC}"
curl -X GET "${BASE_URL}/api/todos/${TODO_ID}" -v 