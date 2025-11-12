#!/bin/bash

# Base URL
BASE_URL="http://localhost:3000"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "Testing Todos Endpoints with Authentication..."

# Test 1: Register a new user
echo -e "\n${GREEN}Test 1: Register a new user${NC}"
REGISTER_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpassword123"
  }')

echo "Registration response: $REGISTER_RESPONSE"

# Store the session cookie
SESSION_COOKIE=$(echo "$REGISTER_RESPONSE" | grep -i "set-cookie" | cut -d';' -f1 | cut -d'=' -f2)

if [ -z "$SESSION_COOKIE" ]; then
  echo -e "${RED}Failed to get session cookie${NC}"
  exit 1
fi

echo "Session cookie: $SESSION_COOKIE"

# Test 2: Get all todos (should be empty initially)
echo -e "\n${GREEN}Test 2: Get all todos${NC}"
curl -X GET "${BASE_URL}/api/todos" \
  -H "Cookie: sb-access-token=$SESSION_COOKIE" -v

# Test 3: Create a new todo
echo -e "\n\n${GREEN}Test 3: Create a new todo${NC}"
CREATE_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/todos" \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=$SESSION_COOKIE" \
  -d '{
    "title": "Test Todo",
    "completed": false
  }')

echo "Create response: $CREATE_RESPONSE"

# Extract the todo ID from the response
TODO_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)

if [ -z "$TODO_ID" ]; then
  echo -e "${RED}Failed to get todo ID${NC}"
  exit 1
fi

echo "Created todo ID: $TODO_ID"

# Test 4: Get the specific todo
echo -e "\n\n${GREEN}Test 4: Get specific todo${NC}"
curl -X GET "${BASE_URL}/api/todos/${TODO_ID}" \
  -H "Cookie: sb-access-token=$SESSION_COOKIE" -v

# Test 5: Update the todo
echo -e "\n\n${GREEN}Test 5: Update todo${NC}"
curl -X PUT "${BASE_URL}/api/todos/${TODO_ID}" \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=$SESSION_COOKIE" \
  -d '{
    "title": "Updated Todo",
    "completed": true
  }' -v

# Test 6: Delete the todo
echo -e "\n\n${GREEN}Test 6: Delete todo${NC}"
curl -X DELETE "${BASE_URL}/api/todos/${TODO_ID}" \
  -H "Cookie: sb-access-token=$SESSION_COOKIE" -v

# Test 7: Verify deletion by trying to get the deleted todo
echo -e "\n\n${GREEN}Test 7: Verify deletion${NC}"
curl -X GET "${BASE_URL}/api/todos/${TODO_ID}" \
  -H "Cookie: sb-access-token=$SESSION_COOKIE" -v 