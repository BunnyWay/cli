# @bunny.net/cli-telemetry

The usage events the [bunny.net CLI](https://github.com/BunnyWay/cli) reports, as a [Zod](https://zod.dev) schema. The CLI types `track()` with it and validates every event before sending; the service that receives the events parses them with the same schema and drops anything it does not list.

```ts
import { CliEvent, EVENTS_PATH, MAX_EVENTS } from "@bunny.net/cli-telemetry";

const parsed = CliEvent.safeParse(input);
if (parsed.success) console.log(parsed.data.event);
```

## Exports

| Export              | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `CliEvent`          | Schema (and type) of one event in the request body     |
| `EventName`         | Union of the event names                               |
| `EventProps<E>`     | The props specific to event `E`                        |
| `CommonProps`       | Props every event may carry                            |
| `EVENTS_PATH`       | Path the CLI posts to; the version is part of the path |
| `USER_AGENT_PREFIX` | Prefix of the `User-Agent` the CLI sends               |
| `MAX_BODY_BYTES`    | Largest request body accepted                          |
| `MAX_EVENTS`        | Events past this count in one request are dropped      |

The request body is a JSON array of `CliEvent`. Unknown props are stripped, free text is cut to 200 characters, and an event that fails validation is dropped on its own.

## Changing the schema

Adding an event, a prop, or an optional field is not breaking. A change that would break a released CLI (a new required field, a different body shape) needs a new `EVENTS_PATH` alongside the old one.
