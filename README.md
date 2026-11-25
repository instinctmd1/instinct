# Instinct

A study party game for IB Diploma Year 1. Everyone gets the same prompt ("Name a determinant of PED"), types every
answer they know before the timer runs out, and rarer answers score more. Two players with the same answer split it.
After each round the full answer list is shown with a one-line explanation of each answer.

Also has solo modes: play against bots, flashcards, a 10-question quiz with 50/50 hints, and an answer bank.

## Play
Open the site, press **Start a room for friends**, and send them the invite link (or the 4-letter code).
The host's tab must stay open — the host's browser runs the game. Up to about 10 players works well.

## How it works
- Plain HTML/CSS/JS, no build tools. Hosted on GitHub Pages.
- Multiplayer uses [PeerJS](https://peerjs.com) (WebRTC): players connect straight to the host's browser through
  PeerJS's free matchmaking and relay servers. No accounts, no database.
- Questions live in `content/<subject>.json`. After editing one, run `python3 build.py` to check it and rebuild `data.js`.
  The rules for writing questions are in `content/SCHEMA.md`.

## Scoring
Obvious 100 · Solid 200 · Sharp 350 · Rare 550 · Instinct 800. Shared answers split the points. A hinted answer
scores half. The only player to find the round's rarest answer (Sharp or better) gets a +150 lone-wolf bonus.
