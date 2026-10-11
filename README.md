# Insurrection: Retake Our Planet

The game system for **Insurrection: Retake Our Planet** on Foundry Virtual Tabletop. Built from scratch for this game: its own data models, sheets, d100 combat, DYNOSRS skill dice, chat cards, stores, concealment checkpoints and the Strategy Layer.

System id `irop`. Foundry 14 and up (verified on 14.368).

## Install

In Foundry's Setup, **Game Systems**, **Install System**, paste this manifest URL into the field at the bottom, and press **Install**:

```
https://github.com/RuneKingThor1/irop-system/releases/latest/download/system.json
```

Then **Create World** with Insurrection: Retake Our Planet as its system. A world keeps its system for life, so an existing world on another system cannot switch to this one.

## Updates

Each version is a release on this repository. When a newer one is out, Foundry's Setup shows **Update** beside the system under Game Systems. Press it, then relaunch the world. Players need only refresh.

**On Sqyre**, which has no Setup screen of its own: open the game's page, **MANAGE GAME**, **Manage Modules**, and install by manifest URL again with the same link above. It always points at the newest release, so installing it again brings the update. The world's data is untouched. The world's Game Settings sidebar shows the version running.

How a release is made: the version in `system.json` goes up, the change is pushed to `main`, and the release workflow (`.github/workflows/release.yml`) builds `irop.zip` and publishes release `v<version>` with the zip and `system.json` attached. A push that does not change the version publishes nothing.

## What it does

- **Operatives and NPCs**: seven attributes, 22 skills, Health, Energy, Armor, Barrier, Luck, dodges, damage reduction by type, paraphysics. Sheets take their accent color from the operative's doctrine.
- **d100 combat**: attacks, dodges and attribute checks roll under, with the cover table, range bands and battlefield modifiers in the roll window; chat cards carry Damage, Critical and Scatter.
- **DYNOSRS**: skill pools read through the canon tables, with Edge, Danger, Victory and Defeat banked for players and the GM.
- **Character building**: roles, species, backgrounds with starting skills and background perks, boons, mutations, perk trees bought with XP, and the Personnel Record.
- **Gear**: weapons, armor, gear and mods, mods fitted by dragging, special ammunition, stacking counted items, carried weight.
- **Stores**: shops players buy from and sell to in three currencies, with stock, markup, hidden items, refunds and buy backs.
- **Concealment**: what an operative carries that shows, against the Slums and Megacity limits, with GM checkpoints.
- **Status effects** with their values, and the **Strategy Layer**: territories, the War Room, Logistics and Intel, Support, events and the ODR phase.

Players read items; the GM writes them. Players may rename their own weapons and armor, and make simple gear of their own.

## Rights

All rights reserved. The game, its rules, text and art are RuneKingThor1's. This repository is public so Foundry can install the system from it; that is not a license to reuse its content.

## Development

The working copy lives outside this repository and is mirrored into it with `sync-repo.py`.

- `python install-local.py` copies the system into the local Foundry data folder for testing (a copy, not a link, so Foundry's Uninstall cannot reach the working copy). JavaScript, template and style changes need only F5 in Foundry; a `system.json` change needs a restart.
- `python pack.py` builds `irop.zip` by hand, the same way the release workflow does.
- Tests, run with Node: `node test/rules.test.mjs`, `node test/models.test.mjs`, `node test/strategy.test.mjs`, and `node test/sheets.test.mjs <node_modules with handlebars and jsdom>`. The models and sheets tests load Foundry's own data layer from a local install.
- `module/config.mjs` is the rules' assumptions block: each value marked as ruled, taken from the live campaign, or assumed.
