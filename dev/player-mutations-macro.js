/**
 * The player mutations (Johnald, 2026-10-12), from the Playable Mutants pages: the Baron's two
 * d20 tables, flat odds, one result per number. Run once as the GM, as a script macro. Safe to
 * run again: a mutation or table already here by name is left as it is.
 *
 * Makes 40 Mutation items (20 Positive, 20 Negative) under Items > Mutations, and two d20 roll
 * tables under Roll Tables > Mutations whose results link to those items, so a roll can be
 * dragged straight onto a Mutant's sheet. At creation a Baron rolls twice on the Positive table
 * (duplicates rerolled) and once on the Negative (one reroll allowed).
 * These are the player tables, not the 32 entry enemy tables.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const DATA = {
    "positive": [
      {
        "roll": 1,
        "to": 1,
        "name": "Armored Hide",
        "description": "<p>Gain +3 Defense and +1 DR against Ballistic, Physical, Laser and Explosive damage.</p>"
      },
      {
        "roll": 2,
        "to": 2,
        "name": "Regenerative Flesh",
        "description": "<p>Regain 1 HP at the start of each of your turns for a total of 10 HP. When out of combat regain your Toughness modifier once per mission.</p>"
      },
      {
        "roll": 3,
        "to": 3,
        "name": "Ossified Frame",
        "description": "<p>Gain +4 ablative armor. Recovers 1 point per turn up to its max of 4 points.</p><p><em>Note: Armor from worn armor is reduced before the Ossified Frame is.</em></p>"
      },
      {
        "roll": 4,
        "to": 4,
        "name": "Twin Hearts",
        "description": "<p>Survive the first fatal blow each mission and come back up with 1 HP automatically.</p>"
      },
      {
        "roll": 5,
        "to": 5,
        "name": "Mutant Fortitude",
        "description": "<p>Death threshold rises to 3x your Toughness modifier.</p>"
      },
      {
        "roll": 6,
        "to": 6,
        "name": "Rapid Metabolism",
        "description": "<p>Once per round, tick one status of your choice down by an additional point. If it is a damage over time effect, when you tick it down by an additional point you do not take the damage from the tick.</p><p><em>Note: This occurs after the turn tick down of a status effect would naturally occur.</em></p>"
      },
      {
        "roll": 7,
        "to": 7,
        "name": "Adrenal Overdrive",
        "description": "<p>Once per combat, spend 1 Luck <strong>and 2 Energy</strong> for an extra action.</p>"
      },
      {
        "roll": 8,
        "to": 8,
        "name": "Powerful Haunches",
        "description": "<p>+1 to Run and Sprint speed.</p>"
      },
      {
        "roll": 9,
        "to": 9,
        "name": "Predatory Senses",
        "description": "<p>You can halve (not ignore) Smoke and Fog penalties, and you cannot be caught Unaware.</p>"
      },
      {
        "roll": 10,
        "to": 10,
        "name": "Ironclad Will",
        "description": "<p>Gain an additional -10 DM to saves against Mind Control and Panicked.</p>"
      },
      {
        "roll": 11,
        "to": 11,
        "name": "Venomous Strike",
        "description": "<p>When using a natural weapon, apply Poisoned (2) <strong>once per turn</strong>. Further more increase max HP by +1.</p>"
      },
      {
        "roll": 12,
        "to": 12,
        "name": "Bioelectric Discharge",
        "description": "<p>For the cost of 4 Energy gain a special discharge attack. For all creatures around you in a 2 tile radius force a TGH save with a +10 D.M. Upon failing they will take your TGH modifier in electric damage, they will also be inflicted with Electrified (2). If they save against the throw they take no damage or effect. Further more increase max Energy by +1.</p>"
      },
      {
        "roll": 13,
        "to": 13,
        "name": "Bio-Spike Launcher",
        "description": "<p>Gain a natural weapon equivalent to either a Assault Rifle, DMR or Shotgun. This is perfectly concealed and undetectable by any standard means.</p><p><em>Note: The mutation is upgradable with bio material.</em></p>"
      },
      {
        "roll": 14,
        "to": 14,
        "name": "Chameleon Hide",
        "description": "<p>Gain the ability to enter Concealment as a Quick Action. Furthermore gain a free assistance dice on all Stealth Checks.</p>"
      },
      {
        "roll": 15,
        "to": 15,
        "name": "Aberrant Potential",
        "description": "<p>Gain a +5 to any attribute. Also gain one rank in any skill.</p><p><em>Note: Skill Rank cannot exceed 2 upon character creation.</em></p>"
      },
      {
        "roll": 16,
        "to": 16,
        "name": "Membranous Wings",
        "description": "<p>You gain a pair of wings! Fly speed equal to Run speed, when taking off it counts as an quick action and costs <strong>3 Energy to do.</strong></p>"
      },
      {
        "roll": 17,
        "to": 17,
        "name": "Mimetic Voice",
        "description": "<p>You can shift your vocal cords to imitate a voice you have heard well; a listener who knows the speaker gets an investigation check to notice something is off. If you are asked to make a social check while imitating a voice you gain an additional assistance dice on the check.</p>"
      },
      {
        "roll": 18,
        "to": 18,
        "name": "Iron Gut",
        "description": "<p>You are immune to any ingested toxins, poisons or venoms. If it is an airborne toxin, poison or venom you gain a -20 DM to the saving throw.</p>"
      },
      {
        "roll": 19,
        "to": 19,
        "name": "Overclocked Cortex",
        "description": "<p>You total amount of bankable edge increases by 1.</p>"
      },
      {
        "roll": 20,
        "to": 20,
        "name": "Echolocation",
        "description": "<p>As a Quick Action costing 2 Energy, map a 8 tile radius through solid walls. You learn positions of creatures but not identities. Creatures within 4 tiles of you can make an Awareness check to detect the sound.</p>"
      }
    ],
    "negative": [
      {
        "roll": 1,
        "to": 1,
        "name": "Frayed Focus",
        "description": "<p>Your Edge bank cap drops from 3 to 2. If you have also rolled Overclocked Cortex you may opt to reroll either this one or that one instead.</p>"
      },
      {
        "roll": 2,
        "to": 2,
        "name": "Squandered Insight",
        "description": "<p>You cannot bank Victory. A rolled Victory must be spent at that check or it is lost.</p>"
      },
      {
        "roll": 3,
        "to": 3,
        "name": "Palsied Hands",
        "description": "<p>Add a Hindrance die to any check involving fine manipulation (lockpicking, demolitions, field medicine, repair)</p>"
      },
      {
        "roll": 4,
        "to": 4,
        "name": "Uncanny Valley",
        "description": "<p>Add a Hindrance die to social checks against any human who can see you clearly. Something in the face reads wrong even when the disguise holds.</p>"
      },
      {
        "roll": 5,
        "to": 5,
        "name": "Predator's Tell",
        "description": "<p>When you fail a Stealth or Deception check, the GM banks one Danger. Your body gives you away in a way you cannot train out: a pupil dilation, a scent shift, a stillness that reads wrong.</p>"
      },
      {
        "roll": 6,
        "to": 6,
        "name": "Brittle Recall",
        "description": "<p>Choose one Intelligence-based skill at creation. On that skill, reduce total skill by 1 dice.</p>"
      },
      {
        "roll": 7,
        "to": 7,
        "name": "Ill Omen",
        "description": "<p>The first time each mission you roll a Danger on a risky check, the GM banks one additional Danger.</p>"
      },
      {
        "roll": 8,
        "to": 8,
        "name": "Rejection Response",
        "description": "<p>Medical checks made to treat you take a Hindrance die. Your physiology fights the treatment.</p>"
      },
      {
        "roll": 9,
        "to": 9,
        "name": "Sensory Flood",
        "description": "<p>In bright light or loud environments, add a Hindrance die to all Perception-based checks.</p>"
      },
      {
        "roll": 10,
        "to": 10,
        "name": "Pyric Susceptibility",
        "description": "<p>Take 50% more fire damage, and Ignited does not tick down on its own for the first round you have the status.</p>"
      },
      {
        "roll": 11,
        "to": 11,
        "name": "Exposed Neural Network",
        "description": "<p>Take 50% more damage from Electricity. The first you take Electric damage in a mission make a +10 D.M. Toughness save to resist Stunned (1).</p>"
      },
      {
        "roll": 12,
        "to": 12,
        "name": "Hollow Bones",
        "description": "<p>Take 2 additional physical damage, and you cannot break free of Pinned unaided if its source is from grappling.</p>"
      },
      {
        "roll": 13,
        "to": 13,
        "name": "Massive Frame",
        "description": "<p>Sprint speed is reduced by 1.</p>"
      },
      {
        "roll": 14,
        "to": 14,
        "name": "Lurching Gait",
        "description": "<p>You provoke Opportunity Attacks even when disengaging.</p>"
      },
      {
        "roll": 15,
        "to": 15,
        "name": "Energy Drain",
        "description": "<p>Max Energy is reduced by 2.</p>"
      },
      {
        "roll": 16,
        "to": 16,
        "name": "Genetic Degradation",
        "description": "<p>Reduce one attribute by 5 (Luck excluded).</p>"
      },
      {
        "roll": 17,
        "to": 17,
        "name": "Radiation Aura",
        "description": "<p>Non-mutant allies directly adjacent to you take a penalty to their rolls. In combat this will be a +5 to any checks made.</p>"
      },
      {
        "roll": 18,
        "to": 18,
        "name": "Slow Clotting",
        "description": "<p>Bleeding applied to you cannot be reduced below 1 by any means until combat ends.</p>"
      },
      {
        "roll": 19,
        "to": 19,
        "name": "Blood Frenzy Trigger",
        "description": "<p>The first time each combat you see an ally reduced to 0 HP, you must spend your next action attacking the creature responsible if it is reachable.</p>"
      },
      {
        "roll": 20,
        "to": 20,
        "name": "Molt Cycle",
        "description": "<p>At the start of each mission, roll 1d6. On a 1 you are mid-molt: you lose any natural armor from mutations and take 1 additional damage from all sources until the mission ends.</p>"
      }
    ]
  };
  const POLARITY = { positive: { label: "Positive", img: "icons/svg/regen.svg" }, negative: { label: "Negative", img: "icons/svg/degen.svg" } };

  /** A folder by name and type, under a parent, made if missing. */
  const folder = async (name, type, parent = null) => game.folders.find(f => (f.type === type) && (f.name === name) && ((f.folder?.id ?? null) === (parent?.id ?? null)))
    ?? Folder.create({ name, type, folder: parent?.id ?? null, sorting: "m" });

  const top = await folder("Mutations", "Item");
  const made = { items: 0, kept: 0, tables: 0 };
  const byPolarity = {};
  for ( const [polarity, rows] of Object.entries(DATA) ) {
    const sub = await folder(`${POLARITY[polarity].label} mutations`, "Item", top);
    const docs = [];
    const fresh = [];
    for ( const r of rows ) {
      const have = game.items.find(i => (i.type === "mutation") && (i.name === r.name));
      if ( have ) { docs.push({ r, doc: have }); made.kept++; continue; }
      fresh.push(r);
    }
    if ( fresh.length ) {
      const created = await Item.createDocuments(fresh.map((r, n) => ({
        name: r.name, type: "mutation", img: POLARITY[polarity].img, folder: sub.id, sort: r.roll * 100,
        system: { polarity, description: r.description }
      })));
      created.forEach((doc, n) => docs.push({ r: fresh[n], doc }));
      made.items += created.length;
    }
    byPolarity[polarity] = docs.sort((a, b) => a.r.roll - b.r.roll);
  }

  const tables = await folder("Mutations", "RollTable");
  for ( const [polarity, docs] of Object.entries(byPolarity) ) {
    const name = `${POLARITY[polarity].label} mutations (d20)`;
    if ( game.tables.find(t => t.name === name) ) continue;
    await RollTable.create({
      name, img: POLARITY[polarity].img, formula: "1d20", replacement: true, displayRoll: true, folder: tables.id,
      description: (polarity === "positive")
        ? "<p>A Baron rolls twice at creation. Reroll duplicates.</p>"
        : "<p>A Baron rolls once at creation, with a single permitted reroll.</p>",
      results: docs.map(({ r, doc }) => ({ type: "document", name: doc.name, img: doc.img, documentUuid: doc.uuid, range: [r.roll, r.to], weight: 1 }))
    });
    made.tables++;
  }
  ui.notifications.info(`Player mutations: ${made.items} made${made.kept ? `, ${made.kept} already here` : ""}, ${made.tables} roll table${made.tables === 1 ? "" : "s"} made.`);
})();
