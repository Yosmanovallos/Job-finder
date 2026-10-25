# Requirements

- AUTH-001: unconfirmed email signup emits no sign_up.
- AUTH-002: repeated callback notifications and reloads emit one browser
  signup for the same account when storage is available.
- AUTH-003: refocus outside callback, token refresh and restored old sessions
  do not emit signup. Returning confirmed authentication emits login.
- AUTH-004: delayed email confirmation is handled using confirmation time;
  invalid timestamps and unsupported providers emit nothing.
- AUTH-005: bounded storage; storage failures never interrupt authentication;
  analytics payload includes only method, plus existing safe acquisition fields.
