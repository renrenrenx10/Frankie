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

    let kbCount = 0;

    try {
        const kbPath = path.join(__dirname, '../kb/frankie_normalized_kb.json');

        if (!fs.existsSync(kbPath)) {
            throw new Error('Brain file missing');
        }

        const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));

        kbCount = kb.length;

        console.log(`🧠 Brain Loaded ............. PASS`);
        console.log(`   Documents: ${kbCount}`);
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

        const vectorPath = path.join(__dirname, '../kb/kb_vectors.json');

        if (!fs.existsSync(vectorPath)) {
            throw new Error('Vector file missing');
        }

        const vectors = JSON.parse(
            fs.readFileSync(vectorPath, 'utf8')
        );

        vectorCount = vectors.chunk_count || 0;

        console.log(`🪡 Stitches Applied ......... PASS`);
        console.log(`   Vectors: ${vectorCount}`);
        console.log(`   Dimensions: ${vectors.dimensions}`);

        if (kbCount && kbCount !== vectorCount) {

            overall = false;

            console.log(
                `   ⚠ Mismatch: ${kbCount} docs vs ${vectorCount} vectors`
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