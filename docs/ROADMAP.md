# EXTINCTION AVENUE — Stage & Boss Roadmap

Stage 1 is what ships today. Stages 2 and 3 are design sketches. Each stage is one 10–12 minute run on its own
on-rails loop of real Manhattan streets, which `route.js` builds from a list of corner points. Every stage keeps the
same structure: an instant swarm opening, a boss cameo around 0:45, an elite or mini-boss every 2–3 minutes, a warning
klaxon, then the headline boss.

## Stage 1 — MIDTOWN MELTDOWN (shipped)

Loop: 5th Ave ↓ → W 34th St ← → 7th Ave ↑ (Times Square) → W 57th St →. Twilight.

| Time | Beat |
|---|---|
| 0:04 | Outbreak stampede (Scuttlers) |
| 0:48 | **GRIDLOCK cameo**: the T. rex crosses the avenue ahead and roars, then leaves |
| 1:15 | Pterosaur flock · 1:45 Sicklejaw stampede out of a side street |
| 2:05 | Elite: Sicklejaw Alpha (faster pounces, drops a supply crate) |
| 2:50 | **Mini-boss: ALPHA RAVAGER**. An elite Brute that roars up Sicklejaw packs and speeds them up |
| 3:35 | Mega Scuttler swarm |
| 4:40 | **Mini-boss: HORNWALL MATRIARCH**. Triple telegraphed lane charges that trample other dinosaurs |
| 5:50 | Elite: Clubtail Bulwark (armored, tail-swipe rings) |
| 6:15 | 200-Scuttler mega swarm, then an elite Skyreaver flock and a Ravager |
| 7:21 | WARNING klaxon |
| 7:30 | **BOSS: GRIDLOCK**. Three phases: chase / enraged / desperate. Weak points are the collar and the thighs |
| after | Victory, then results, or continue in endless mode (scaling waves) |

## Stage 2 — WEST SIDE TIDE (sketch)

Loop: West Side Highway ↓ along the Hudson → W 23rd St → 10th Ave ↑ (the High Line overhead) → W 42nd St. Rain,
night, wet asphalt (SSR shines here).

- **New enemies:** *Spinesail* (a sail-backed semi-aquatic hunter that bursts out of flooded underpasses). *Mudslinger*
  (small hadrosaur-type herds that stampede in lanes and act as moving cover).
- **Elites:** Spinesail Alpha (submerges, then resurfaces under the car's predicted position; ground-ripple
  telegraph). Armored Hornwall convoy (3 chargers in formation).
- **Mini-boss: THE LOCKKEEPER**. A giant crocodilian-type that clamps onto the cab and drags it toward the river until
  you shoot the glowing jaw hinge. A struggle meter mashes into nitro.
- **BOSS: THE HUDSON LEVIATHAN**, a mosasaur-type marine reptile, 30 m long.
  - Intro: the highway railing explodes as it breaches the Hudson in a wall of water (camera on the river side, name card).
  - Phase 1, *Breach*: it surfaces alongside the highway and lunges across the lanes. A water-shadow telegraph shows
    where. Shoot the glowing gill vents while it's exposed.
  - Phase 2, *Tidal*: tail-slams send waves over the road (horizontal wall telegraph; boost or brake to time the gap)
    and swallow wrecks it then spits out as projectiles.
  - Phase 3, *Beached*: it hauls itself onto the highway and chases on its flippers (reuses the GRIDLOCK route-chase
    code). The weak point is the cracked containment harness on its back.
  - Death: it slides back into the river, fossilizes mid-splash, and the shards rain down. The camera rises with the
    spray.

## Stage 3 — CENTRAL PARK STAMPEDE (sketch)

Loop: Central Park South → park drives (East Drive ↑, West Drive ↓) → Columbus Circle. Golden hour, trees, open lawns
(much bigger swarms).

- **New enemies:** *Ridgeback* (stegosaur-type, 360° tail-spike ring). *Glider* swarms (small flying reptiles in
  murmurations; chain-lightning heaven).
- **Elites:** Ridgeback Patriarch (plates glow before a spike volley). Glider Queen (dive-bombs with a flock escort).
- **Mini-boss: TWIN HORNS**. Two Hornwall Matriarchs charging from opposite ends of the drive in crossing lanes.
- **BOSS: SKYLINE**, a sauropod-type titan, 40 m long and taller than the park's trees.
  - It doesn't chase. It *rampages*: each footfall is a huge stomp ring with a delayed shockwave, and its tail sweeps
    clear the whole drive (jump the tail with a nitro ramp moment).
  - Climb phase: the car drives *under* it between its legs. Shoot the four glowing leg-collar locks to topple it.
  - Neck phase: the head comes down to roar at the cab; hit the throat collar for the kill.
  - Death: a slow-motion fall across the park drive. The fossilized body becomes a bridge the car drives over in the
    outro.

## Systems that make the stages work

- **Stage select / map screen.** It unlocks per boss kill, which is good for retention and sharing ("I unlocked the
  Leviathan").
- **Per-stage modifiers.** Rain lowers grip and gives a wider steer drift. Night adds headlight cones and darker,
  more readable glowing markings.
- **Meta progression (light).** Cretagen "bounty" currency → unlock cab liveries and starting weapons. No pay-to-win.
- **Daily seed run** with a shared leaderboard and a "same run as your friend" share link (the seed in the URL).
