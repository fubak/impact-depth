let meta = #{
    name: "visual-upgrade-gauntlet",
    description: "Parent visual gauntlet: combat VFX, foam/spray, lighting, weather coupling",
    when_to_use: "Upgrade Silent Depths look: explosions, foam, lighting, weather. Not poly counts.",
    phases: [
        #{ title: "Sub-loops", detail: "four disjoint file stations" },
        #{ title: "Verify", detail: "read-only check that stations stayed in scope" },
    ],
};

let station_schema = #{
    "type": "object",
    "required": ["station", "files", "summary"],
    "properties": #{
        "station": #{ "type": "string" },
        "files": #{ "type": "array", "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "blocked": #{ "type": "boolean" },
    },
};

phase("Sub-loops");

let vfx_prompt = "Silent Depths. Station combat-vfx. Edit ONLY src/render/vfx.ts and tests/render/vfx.test.ts. Replace SphereGeometry MeshBasicMaterial hits with a shared radial Sprite (additive) for explosion/plume/pickup/wake. Keep emit/getDiagnostics/setCap/update/dispose. Do not write gameplay state. Do not edit scene.ts. Use read_file then search_replace. Run npx vitest run tests/render/vfx.test.ts. Return station, files, summary.";

let foam_prompt = "Silent Depths. Station foam-spray. Edit ONLY src/render/ocean/world-foam.ts and src/render/ocean/crest-spray.ts and tests/render/world-foam.test.ts. Tighten foam deposit so it dies on land and stays in the surf band; keep GPU spray spawning on breaking crests. Do not edit ocean.ts or scene.ts. Use read_file then search_replace. Run npx vitest run tests/render/world-foam.test.ts. Return station, files, summary.";

let light_prompt = "Silent Depths. Station lighting. Edit ONLY src/render/presentation/hull-materials.ts and tests/render/hull-materials.test.ts. After restore, clamp metalness <= 0.18 and roughness >= 0.5; slightly reduce envMapIntensity fill. No cyan emissive. Do not edit scene.ts. Use read_file then search_replace. Run npx vitest run tests/render/hull-materials.test.ts. Return station, files, summary.";

let weather_prompt = "Silent Depths. Station weather-coupling. Edit ONLY src/render/environment/weather.ts and tests/render/weather.test.ts. Ensure storm raises foamAmount/windDetail and calm lowers them (already mostly true). Add a small exported helper stormFoamLife(preset) used by tests. Do not edit scene.ts. Use read_file then search_replace. Run npx vitest run tests/render/weather.test.ts. Return station, files, summary.";

let jobs = [
    #{ prompt: vfx_prompt, label: "combat-vfx", model: "grok-4.5", capability_mode: "execute", output_schema: station_schema },
    #{ prompt: foam_prompt, label: "foam-spray", model: "grok-4.5", capability_mode: "execute", output_schema: station_schema },
    #{ prompt: light_prompt, label: "lighting", model: "grok-4.5", capability_mode: "execute", output_schema: station_schema },
    #{ prompt: weather_prompt, label: "weather", model: "grok-4.5", capability_mode: "execute", output_schema: station_schema },
];
let results = parallel(jobs);

let summaries = [];
let i = 0;
for r in results {
    if r == () || !r.success {
        log("station " + i.to_string() + " failed or empty");
    } else if r.output.summary != () {
        summaries.push(r.output.station + ": " + r.output.summary);
    }
    i += 1;
}

phase("Verify");
let verify = agent(
    "Read-only. Confirm these files exist and still export prior APIs: src/render/vfx.ts VfxPool, src/render/ocean/world-foam.ts WorldFoamSystem, src/render/presentation/hull-materials.ts applyHullPresentation, src/render/environment/weather.ts WeatherController. Do not edit. Return station=verify, files=[], summary of any API break.",
    #{ label: "verify", capability_mode: "read-only", model: "grok-4.5", output_schema: station_schema },
);

let verify_summary = "verify skipped";
if verify != () && verify.success && verify.output.summary != () {
    verify_summary = verify.output.summary;
}

complete(#{
    summary: summaries.len().to_string() + " sub-loops returned; " + verify_summary,
    stations: summaries,
});
