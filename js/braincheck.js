const fs = require('fs');
const path = require('path');

async function brainCheck({
    groqClient = null,
    claudeClient = null
} = {}) {

    console.log('\n══════════ FRANKIE BRAIN CHECK ══════════\n');

    let overall = true;

    //
    // 🧠 Brain Loaded
    //

    // Fixed 2026-08-03: was reading the superseded single-file
    // frankie_normalized_kb.json / kb_vectors.json — stale since the KB
    // rebuild split Frankie into 4 partitions. Now sums across all 4.
    const KB_PARTITIONS = [
        { kb: 'frankie7_supplier_kb.json',  vectors: 'frankie7_supplier_vectors.json' },
        { kb: 'frankie_toolkit_kb.json',    vectors: 'frankie_toolkit_vectors.json' },
        { kb: 'frankie_regs_kb.json',       vectors: 'frankie_regs_vectors.json' },
        // reactors vectors is ~1.8GB — don't JSON.parse the whole thing just
        // for a health check, just confirm it exists and report its size.
        { kb: 'frankie_reactors_kb.json',   vectors: 'frankie_reactors_vectors.json', skipVectorParse: true },
    ];

    let kbCount = 0;

    try {
        let missing = [];
        for (const p of KB_PARTITIONS) {
            const kbPath = path.join(__dirname, '../kb/', p.kb);
            if (!fs.existsSync(kbPath)) {
                missing.push(p.kb);
                continue;
            }
            const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
            const chunks = Array.isArray(kb) ? kb.length
                         : Array.isArray(kb?.chunks) ? kb.chunks.length
                         : (kb?.meta?.total_chunks ?? 0);
            kbCount += chunks;
        }

        if (missing.length === KB_PARTITIONS.length) {
            throw new Error('Brain files missing');
        }

        console.log(`🧠 Brain Loaded ............. ${missing.length ? 'WARN' : 'PASS'}`);
        console.log(`   Documents: ${kbCount} across ${KB_PARTITIONS.length - missing.length}/${KB_PARTITIONS.length} partitions`);
        if (missing.length) {
            console.log(`   Missing: ${missing.join(', ')}`);
        }
    }
    catch (err) {
        overall = false;

        console.log(`🧠 Brain Loaded ............. FAIL`);
        console.log(`   ${err.message}`);
    }

    //
    // 🪡 Stitches Applied
    //

    let vectorCount = 0;

    try {
        let missing = [];
        let lastDims = null;
        let skippedNote = null;
        for (const p of KB_PARTITIONS) {
            const vectorPath = path.join(__dirname, '../kb/', p.vectors);
            if (!fs.existsSync(vectorPath)) {
                missing.push(p.vectors);
                continue;
            }
            if (p.skipVectorParse) {
                const sizeGB = (fs.statSync(vectorPath).size / 1e9).toFixed(1);
                skippedNote = `${p.vectors} present (${sizeGB}GB, not parsed — too large for a routine check)`;
                continue;
            }
            const vectors = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));
            vectorCount += (vectors.chunk_count || 0);
            lastDims = vectors.dimensions ?? lastDims;
        }

        if (missing.length === KB_PARTITIONS.length) {
            throw new Error('Vector files missing');
        }

        console.log(`🪡 Stitches Applied ......... ${missing.length ? 'WARN' : 'PASS'}`);
        console.log(`   Vectors: ${vectorCount} across ${KB_PARTITIONS.length - missing.length}/${KB_PARTITIONS.length} partitions`);
        console.log(`   Dimensions: ${lastDims}`);
        if (skippedNote) {
            console.log(`   ${skippedNote}`);
        }
        if (missing.length) {
            console.log(`   Missing: ${missing.join(', ')}`);
        }

        if (kbCount && kbCount !== vectorCount) {

            console.log(
                `   ⚠ Note: ${kbCount} chunks vs ${vectorCount} vectors — expected while reactors vectors aren't parsed here; also chunk ids could collide pre-fix, re-run after re-embedding`
            );
        }

    }
    catch (err) {

        overall = false;

        console.log(`🪡 Stitches Applied ......... FAIL`);
        console.log(`   ${err.message}`);
    }

    //
    // ⚡ Bolts Attached
    //

    if (groqClient) {

        try {

            await groqClient.chat.completions.create({
                messages: [
                    {
                        role: 'user',
                        content: 'Reply READY'
                    }
                ],
                model: 'llama-3.3-70b-versatile',
                max_tokens: 5
            });

            console.log(`⚡ Bolts Attached ........... PASS`);

        }
        catch (err) {

            overall = false;

            console.log(`⚡ Bolts Attached ........... FAIL`);
            console.log(`   ${err.message}`);
        }

    }
    else {

        console.log(`⚡ Bolts Attached ........... DISABLED`);
    }

    //
    // 👓 X-Ray Spex
    //

    if (claudeClient) {

        try {

            await claudeClient.messages.create({
                model: 'claude-3-5-sonnet-latest',
                max_tokens: 10,
                messages: [
                    {
                        role: 'user',
                        content: 'Reply READY'
                    }
                ]
            });

            console.log(`👓 X-Ray Spex ............... PASS`);

        }
        catch (err) {

            overall = false;

            console.log(`👓 X-Ray Spex ............... FAIL`);
            console.log(`   ${err.message}`);
        }

    }
    else {

        console.log(`👓 X-Ray Spex ............... DISABLED`);
    }

    //
    // Summary
    //

    console.log('\n══════════════════════════════════════════');

    if (overall) {

        console.log('\n🟢 FRANKIE IS ALIVE\n');
    }
    else {

        console.log('\n🔴 FRANKIE NEEDS ATTENTION\n');
    }

    return overall;
}

module.exports = brainCheck;