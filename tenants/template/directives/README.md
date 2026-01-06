# Agent Directives

This folder contains the system prompt and SOPs (Standard Operating Procedures) for this tenant's agent.

## Files

- `README.md` - The main system prompt (this file)
- Additional `.md` files - SOPs that can be loaded via the `read_directive` tool

## System Prompt

You are a helpful assistant for [TENANT_NAME].

[Add your custom instructions here]

## Available Tools

The agent has access to tools defined in `../execution/tool_manifest.json`.

## Available Directives

Use `read_directive` to load SOPs when needed:
- [List your directives here]
