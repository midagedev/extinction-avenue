# EXTINCTION AVENUE — Stage & Boss Roadmap

Stage 1 is what ships today. Stages 2 and 3 are design sketches. Since v2 the game is a first-person arcade rail
shooter: the cab drives itself along an on-rails loop of real Manhattan streets (`route.js` builds it from a list of
corner points) and the player is the rear gunner. Each stage is one 6–8 minute run scripted as BEATS (`director.js`):
chases where pursuers pour down the road behind the cab, combat zones where the cab stops, storefront and side-street
ambushes that swing the view, pterosaur raids, two mini-bosses, a stampede peak, a breather, a warning klaxon, then the
headline boss. Normal beats keep 5–20 dinosaurs in play; peaks reach 30–40 for a few seconds.

## Stage 1 — MIDTOWN MELTDOWN (shipped)

Loop: 5th Ave ↓ → W 34th St ← → 7th Ave ↑ (Times Square) → W 57th St →. Twilight. Times below are nominal; combat
zones and mini-boss beats end early when cleared.

| Time | Beat |
|---|---|
| 0:00 | ROLL OUT: grace period, nobody may attack for 8 s; two Scuttlers appear down the road |
| 0:10 | OUTBREAK: Scuttlers + the first Sicklejaws chase the cab, 1 attacker at a time, the longest telegraphs; first supply drop (overdrive) |
| 0:50 | STOREFRONT: raptors smash out of shop windows on both sides; **GRIDLOCK cameo**: it crosses the street behind the cab and roars |
| 1:18 | INCOMING FROM ABOVE: first pterosaur dives at the gunner (the view tilts up) |
| 1:34 | **COMBAT ZONE**: the cab stops at an intersection; ambush left, ambush right (the view swings), first Brute |
| 2:21 | AVENUE CHASE at 18 m/s: raptor packs, pterosaurs, a Brute; repair drop |
| 3:06 | **Mini-boss: ALPHA RAVAGER**, an elite Brute that howls up Sicklejaws |
| 3:46 | **COMBAT ZONE**, Times Square: a Hornwall charges down a red lane, Clubtail, storefront raptors, a Scuttler pack from a side street |
| 4:35 | CROSSFIRE: side-street ambushes from both flanks |
| 5:07 | SKY RAID: a pterosaur flock including an elite |
| 5:41 | **Mini-boss: HORNWALL MATRIARCH**, repeated lane charges (shoot her face to stagger her) |
| 6:20 | STAMPEDE: the 30–40 peak, then it dries up |
| 7:02 | …QUIET: repair drop, WARNING klaxon |
| ≈6:30–7:17 | **BOSS: GRIDLOCK**. Chase / enraged (flank runs) / desperate (head-on charge). Collar ×2.5 (×3.5 in phase 3) |
| after | Victory, then results, or continue in endless mode (beats loop with rising HP and damage) |

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
