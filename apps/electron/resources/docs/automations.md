# Automations Configuration Guide

OPC Agent reads optional workspace automations from `<workspace>/automations.json`. The bundled reference is synced to `~/.opcagent/docs/automations.md`.

If the file does not exist, that is a valid state with no automations. Create it directly when needed; do not try to read it first. Start with this valid version 2 root:

```json
{
  "version": 2,
  "automations": {}
}
```

Do not store passwords, tokens, API keys, or other credentials in `automations.json`.

## File structure

`automations` maps an event name to one or more matchers. Every matcher must have a non-empty `actions` array.

```json
{
  "version": 2,
  "automations": {
    "SchedulerTick": [
      {
        "name": "Daily review",
        "cron": "0 9 * * 1-5",
        "timezone": "Asia/Shanghai",
        "labels": ["scheduled"],
        "actions": [
          { "type": "prompt", "prompt": "Review the open work and prepare a concise summary." }
        ]
      }
    ]
  }
}
```

Matcher fields:

- `id`: optional short identifier. OPC Agent may add one for a matcher that does not have it.
- `name`: optional display name.
- `matcher`: optional regular expression. If omitted, the matcher accepts every occurrence of its event.
- `cron`: five-field schedule for `SchedulerTick` only: minute, hour, day of month, month, day of week.
- `timezone`: optional IANA timezone such as `Asia/Shanghai`.
- `permissionMode`: optional `safe`, `ask`, or `allow-all` mode for sessions created by prompt actions. Prefer `safe` or `ask`.
- `labels`: optional labels applied to sessions created by prompt actions.
- `enabled`: set to `false` to keep a matcher without running it.
- `conditions`: optional filters evaluated after the matcher but before actions.
- `telegramTopic`: optional 1-128 character forum-topic name for a paired Telegram supergroup. It is ignored if the group, connected bot, or required topic permission is unavailable.

## Events

Application events support prompt and webhook actions:

- `LabelAdd`, `LabelRemove`, `LabelConfigChange`
- `PermissionModeChange`, `FlagChange`, `SessionStatusChange`
- `SchedulerTick`

Agent events support prompt actions only:

- `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`
- `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`
- `SubagentStart`, `SubagentStop`, `PreCompact`, `PermissionRequest`, `Setup`

For most events, `matcher` is a regular expression against the event's principal value: label for label events, the new permission mode, flag value, new session status, or tool name. `SchedulerTick` uses `cron`, not a regular-expression matcher.

## Actions

### Prompt

```json
{ "type": "prompt", "prompt": "Summarize the session after the label is added." }
```

Prompt actions also accept optional `llmConnection`, `model`, and `thinkingLevel` fields. Prompt text can mention available skills with `@skill-slug`.

### Webhook

Webhooks are available for application events, not agent events.

```json
{
  "type": "webhook",
  "url": "${OPCAGENT_WH_ALERT_URL}",
  "method": "POST",
  "headers": { "X-Event": "${OPCAGENT_EVENT}" },
  "bodyFormat": "json",
  "body": { "session": "${OPCAGENT_SESSION_ID}" },
  "captureResponse": true
}
```

Supported methods are `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`. `bodyFormat` is `json`, `form`, or `raw`. Optional `auth` is either `{ "type": "basic", "username": "...", "password": "..." }` or `{ "type": "bearer", "token": "..." }`; do not put real credentials in the configuration.

Webhook substitutions include `OPCAGENT_EVENT`, `OPCAGENT_EVENT_DATA`, `OPCAGENT_SESSION_ID`, `OPCAGENT_SESSION_NAME`, `OPCAGENT_WORKSPACE_ID`, and event payload fields converted to `OPCAGENT_*`. Scheduler events also provide `OPCAGENT_LOCAL_TIME` and `OPCAGENT_LOCAL_DATE`.

For a webhook URL or authorization value, set a secret outside this file with the `OPCAGENT_WH_` prefix, then reference it as `${OPCAGENT_WH_NAME}`. Webhook actions receive only these user-defined `OPCAGENT_WH_*` variables plus the event variables; arbitrary environment variables are not available to them.

## Conditions

All conditions in `conditions` must pass. A time condition accepts optional `after` and `before` values in `HH:MM`, a `weekday` array of `mon` through `sun`, and an optional IANA `timezone`.

```json
{
  "condition": "time",
  "after": "09:00",
  "before": "18:00",
  "weekday": ["mon", "tue", "wed", "thu", "fri"]
}
```

A state condition requires one operator group: `value`; `from` and/or `to`; `contains`; or `not_value`.

```json
{
  "condition": "state",
  "field": "permissionMode",
  "from": "safe",
  "to": "allow-all"
}
```

Use `and`, `or`, or `not` with a non-empty `conditions` array to combine conditions.

## Validation

Use the Automations screen to edit or test a configuration. OPC Agent validates JSON, event names, action shape, five-field cron expressions, timezones, regular expressions, and condition depth. A missing file is valid; no shell command or external CLI is required to create or validate the first configuration.
