# Flow data format

The frontend persists one JSON object containing `flows`, `selectedFlowId`, and `settings`.

A click action is flat and serializes directly to the Rust `FlowAction::Click` variant:

```json
{
  "type": "click",
  "id": "uuid",
  "name": "Open inventory",
  "screenX": 1111,
  "screenY": 694,
  "relativeX": 261,
  "relativeY": 412,
  "windowTitle": "Pockie Ninja — Mozilla Firefox",
  "delayMs": 830
}
```

A delay action:

```json
{
  "type": "delay",
  "id": "uuid",
  "name": "Wait for animation",
  "delayMs": 500
}
```

`delayMs` on a click is the elapsed delay before that click. Recording observes global pointer movement only to know the current pointer coordinate; movement is never persisted as an action.

## Copy semantics

Combining flows and importing actions always:
1. deep-copy the action;
2. generate a fresh action ID;
3. insert the copy into the destination;
4. leave the source flow untouched.
