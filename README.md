# The Daily Lap

A daily arcade time trial for r/theDailyLap. Everyone races the same UTC day's
course, learning where to accelerate and where to slow down. Courses mix fast
sweepers, switchbacks, compact bends and hills, with occasional deliberate jumps
and grade-separated overpasses.

## How to play

Open the race post and start the game. Hold the on-screen control or Space to
accelerate; release to brake. The car follows the course, so speed and braking
timing are your controls. The countdown gives each attempt a timed start.

Finish a lap to request a verified result. Ranked results require a Reddit
account and server acceptance of the recorded driving inputs. Retry to improve
your personal best and compare today's standings. Practice mode offers other
courses without ranked results. Sound can be changed in Settings.

## For moderators and reviewers

The app has a custom inline launch screen and an expanded game view. Installation
or upgrade prepares the current UTC day's race post, and a five-minute scheduled
check maintains daily availability. The moderator menu's **Create today's race**
action opens the existing race or creates a missing one. Daily publication is
guarded by app/community checks for r/theDailyLap.

The maintained app is `the-daily-lap`. Keep the existing live service and records
in place while review is pending. Any required cutover must preserve that service
and ensure only one daily publisher is active. Review submission alone neither
installs the app nor creates a race post.

## Data and permissions

Reddit identity is used for ranked submissions. Daily courses, race sessions,
verification receipts and per-account leaderboard results are stored in
Reddit-hosted Redis scoped to this app's subreddit installation. The server
replays submitted inputs before accepting a score. A valid replay does not prove
human play. The app uses Reddit's app APIs and Redis; no external fetch domains,
payments or user-action permissions are configured.

## Release and support

The intended launch is an approved **unlisted** app on r/theDailyLap, without an
App Directory listing. The guarded [review workflow](docs/reddit-review-release.md)
uploads an exact version and source for Reddit review. Approval and any later
public installation must be verified separately. This README does not claim that
the new app has been registered, approved or installed.

Report problems to the community moderators or the
[project issue tracker](https://github.com/kickflip-games/reddit_racer/issues).
See [development and validation notes](DEVELOPMENT.md),
[asset licenses](docs/assets.md), and the
[identity and cutover boundaries](docs/app-identity-migration.md).
