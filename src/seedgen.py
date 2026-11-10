#!/usr/bin/env python3
"""Generate seed.json for the Wide weight-space explorer prototype.

Everything here is mock session content, but every number is exact and
regenerated deterministically, so the browser and the test harness agree.
Digests are real sha256 over the mock content strings.
"""
import hashlib
import json

EVAL_CLOCK = "2026-11-09T18:42:00Z"
MICRO = 1_000_000


def digest(*parts):
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def rnd_vector(seed, n=8, lo=1200, hi=9000):
    """Deterministic signed integer vector from a seed string."""
    out = []
    h = hashlib.sha256(seed.encode()).digest()
    while len(out) < n:
        h = hashlib.sha256(h).digest()
        for i in range(0, 32, 4):
            if len(out) >= n:
                break
            word = int.from_bytes(h[i:i + 4], "big")
            mag = lo + word % (hi - lo)
            sign = -1 if (word >> 15) & 1 else 1
            out.append(sign * mag)
    return out


# ---------------------------------------------------------------- premises
P = []


def premise(pid, kind, subkind, label, statement, authority, locator,
            registered, valid_until=None, derivation=None, note=None):
    P.append({
        "id": pid,
        "kind": kind,
        "subkind": subkind,
        "label": label,
        "statement": statement,
        "authority": authority,
        "registered": registered,
        "valid_until": valid_until,
        "derivation": derivation,
        "note": note,
        "source": locator,
    })


premise("F-CORPUS-0412", "fact", "corpus",
        "corpus tier3-shard-0412 admitted",
        "412,880,113 tokens, license clean, dedup 0.91, no eval overlap",
        "compiler:admission", "admission/0412.manifest", "2026-11-07T09:14:20Z")
premise("F-CORPUS-0413", "fact", "corpus",
        "corpus tier3-shard-0413 admitted",
        "388,102,774 tokens, license clean, dedup 0.88, no eval overlap",
        "compiler:admission", "admission/0413.manifest", "2026-11-07T09:14:22Z")
premise("F-TOKENIZER", "fact", "substrate",
        "tokenizer v3 frozen",
        "vocab 32000, no merges admitted after step 0, normalization NFC",
        "compiler:admission", "substrate/tokenizer.v3.id", "2026-11-06T22:03:11Z")
premise("F-INIT-SEED", "fact", "substrate",
        "initialization: xavier-uniform, seed 7f2a91",
        "all layer-0 and embedding seatings anchor on this initialization",
        "compiler:admission", "substrate/init.xavier.seed7f2a91", "2026-11-06T22:03:12Z")
premise("F-DTYPE", "fact", "descriptor",
        "dtype policy: bf16 storage, fp32 accumulate",
        "cast once on store; every snapshot converts to the anchor dtype once",
        "compiler:admission", "descriptor/dtype.policy.v1", "2026-11-06T22:03:13Z")
premise("O-PERPLX-431", "observation", "measurement",
        "held-out perplexity 4.31",
        "tier3-eval, n=2048, bf16, measured at ckpt-18400",
        "observer:eyes",
        "eyes/perplexity/tier3-eval/run-8821",
        "2026-11-09T11:02:04Z",
        derivation={"rule": "measure/perplexity",
                    "cites": ["w-b3-qkv", "w-b3-out", "w-head-proj"]})
premise("O-PERPLX-398", "observation", "measurement",
        "held-out perplexity 3.98 after learning pass",
        "tier3-eval, n=2048, bf16, measured after learn-1 pass 3",
        "observer:eyes",
        "eyes/perplexity/tier3-eval/run-8844",
        "2026-11-09T15:41:55Z",
        derivation={"rule": "measure/perplexity",
                    "cites": ["w-b7-out", "w-head-proj"]})
premise("O-GRADNORM", "observation", "measurement",
        "gradient norm 0.84 at step 18400",
        "fp32 accumulate, accum 4, clip 1.0 never engaged",
        "observer:eyes", "eyes/grad/step-18400", "2026-11-09T09:12:40Z",
        derivation={"rule": "measure/grad-norm", "cites": ["w-b3-fc1"]})
premise("O-LOSS-SPIKE", "observation", "anomaly",
        "loss spike 3.2σ at step 17920",
        "recovered by step 17990; attributed to shard 0413 boundary",
        "observer:eyes", "eyes/loss/step-17920", "2026-11-08T23:20:13Z",
        derivation={"rule": "measure/loss-trace", "cites": ["w-b0-qkv", "w-embed-pos"]})
premise("O-CHANEQ", "observation", "measurement",
        "channel energy spread 4.8% in blocks.3.attn.out",
        "per-head energy, 16 heads, delta against seating chain head",
        "observer:eyes", "eyes/energy/blocks.3.attn.out", "2026-11-09T12:31:09Z",
        derivation={"rule": "measure/channel-energy", "cites": ["w-b3-out"]})
premise("R-LEARN1", "rule", "learning",
        "learn-1: candidate choice, +1 capped",
        "cites the original choice, O1, O2, O3; publishes an appended seating",
        "learner:learn-1", "rules/learn-1.v3.id", "2026-11-06T22:10:00Z")
premise("R-OPT-ADAMW", "rule", "optimizer",
        "adamw lr 3e-4 cosine to 0, wd 0.1",
        "β 0.9/0.95, eps 1e-8, no warmup after restart 2",
        "learner:optimizer", "rules/adamw.v2.id", "2026-11-06T22:10:02Z")
premise("R-CURRICULUM", "rule", "schedule",
        "curriculum tier2 → tier3 at 80% of step budget",
        "tier3 admitted into the batch mix from step 14720",
        "learner:schedule", "rules/curriculum.v1.id", "2026-11-06T22:10:05Z")
premise("C-EQUALIZE", "constraint", "structural",
        "channel equalization: per-head energy within 2%",
        "checked per head; a violated head refuses, it does not clip",
        "operator:clpi", "constraints/equalize.v2.id", "2026-11-07T18:02:44Z")
premise("C-QUANT", "constraint", "structural",
        "int8 group 64, asymmetric, clip 4.0",
        "per-axis scale, zero point recomputed per group, refuses on overflow",
        "operator:clpi", "constraints/quant-int8.v1.id", "2026-11-07T18:04:10Z")
premise("C-TIED-EMBED", "constraint", "structural",
        "output projection tied to token embedding",
        "head.proj shares the token embedding seating; no independent payload",
        "operator:clpi", "constraints/tied-embed.v1.id", "2026-11-07T18:05:00Z")
premise("A-OPERATOR-SAFETY", "authority", "approval",
        "operator approved safety-slice reweight",
        "layer-7 attention and layer-11 block, approved by clpi at 09:41",
        "operator:clpi", "authority/approvals/2026-11-09.yaml#safety-slice",
        "2026-11-09T17:41:02Z")
premise("A-REVIEW-1842", "authority", "review",
        "review 1842 accepted: layer-7 attention",
        "two seat review, both seats accept the seating chain as standing",
        "operator:clpi", "authority/reviews/1842.md", "2026-11-09T13:20:44Z")
premise("A-PROVISIONAL-QKV", "authority", "provisional",
        "provisional: layer-7 qkv delta until ckpt-19000",
        "admits the operator reweight only while the checkpoint is below 19000",
        "operator:clpi", "authority/provisional/ckpt-19000.md",
        "2026-11-09T17:42:10Z",
        valid_until="2026-11-10T00:00:00Z",
        note="Expires in about 5 hours at the session clock. Expiry is shown as a "
             "warning only: this prototype does not auto-retract on expiry.")

# ----------------------------------------------------------------- weights
W = []


def held(wid, name, dims, dtype, layer, role, anchor_cites, events):
    W.append({
        "id": wid, "name": name, "dims": dims, "dtype": dtype,
        "kind": "held", "layer": layer, "role": role,
        "anchor": {"cites": anchor_cites,
                   "values": rnd_vector("anchor|" + wid, 8, 18000, 92000)},
        "relation": None,
        "events": events,
    })


def derived(wid, name, dims, dtype, layer, role, deps, relation, premises):
    W.append({
        "id": wid, "name": name, "dims": dims, "dtype": dtype,
        "kind": "derived", "layer": layer, "role": role,
        "anchor": None,
        "relation": dict(relation, deps=deps, premises=premises),
        "events": [],
    })


def ev(eid, rule, step, cites, note):
    return {"id": eid, "rule": rule, "step": step,
            "delta": rnd_vector("delta|" + eid, 8, 300, 9200),
            "cites": cites, "note": note}


held("w-embed-tok", "embed.tok.weight", [32000, 512], "bf16", "embed", "embedding",
     ["F-TOKENIZER", "F-DTYPE"], [
         ev("e-tok-1", "reweight", 14208, ["F-CORPUS-0412", "R-OPT-ADAMW"],
            "shard 0412 folded into the embedding rows it touches"),
         ev("e-tok-2", "curriculum-fold", 15120, ["F-CORPUS-0413", "R-CURRICULUM"],
            "tier-3 rows admitted mid-schedule"),
     ])
held("w-embed-pos", "embed.pos.weight", [1024, 512], "bf16", "embed", "embedding",
     ["F-INIT-SEED", "F-DTYPE"], [
         ev("e-pos-1", "reweight", 640, ["R-OPT-ADAMW"],
            "positional table never re-anchored; one reweight only"),
     ])
held("w-b0-qkv", "blocks.0.attn.qkv.weight", [512, 1536], "bf16", "blocks.0", "attn.qkv",
     ["F-INIT-SEED", "F-DTYPE"], [
         ev("e-b0qkv-1", "reweight", 17952, ["F-CORPUS-0412", "R-OPT-ADAMW", "O-LOSS-SPIKE"],
            "post-spike recovery step"),
     ])
held("w-b0-fc1", "blocks.0.mlp.fc1.weight", [512, 2048], "bf16", "blocks.0", "mlp.fc1",
     ["F-INIT-SEED", "F-DTYPE"], [
         ev("e-b0fc1-1", "reweight", 18016, ["F-CORPUS-0412", "R-OPT-ADAMW"],
            "steady-state step after recovery"),
     ])
held("w-b0-fc2", "blocks.0.mlp.fc2.weight", [2048, 512], "bf16", "blocks.0", "mlp.fc2",
     ["F-INIT-SEED", "F-DTYPE"], [
         ev("e-b0fc2-1", "reweight", 18016, ["F-CORPUS-0412", "R-OPT-ADAMW"],
            "steady-state step after recovery"),
     ])
held("w-b3-qkv", "blocks.3.attn.qkv.weight", [512, 1536], "bf16", "blocks.3", "attn.qkv",
     ["F-DTYPE"], [
         ev("e-b3qkv-1", "reweight", 18400, ["F-CORPUS-0412", "R-OPT-ADAMW", "O-GRADNORM"],
            "gradient-norm-conditioned reweight"),
     ])
held("w-b3-out", "blocks.3.attn.out.weight", [512, 512], "bf16", "blocks.3", "attn.out",
     ["F-DTYPE"], [
         ev("e-b3out-1", "reweight", 18368, ["R-OPT-ADAMW", "O-GRADNORM"],
            "output projection follows the gradient observation"),
     ])
held("w-b3-fc1", "blocks.3.mlp.fc1.weight", [512, 2048], "bf16", "blocks.3", "mlp.fc1",
     ["F-DTYPE"], [
         ev("e-b3fc1-1", "curriculum-fold", 15408, ["F-CORPUS-0412", "R-CURRICULUM"],
            "tier-3 width admitted into the first mlp"),
     ])
held("w-b3-fc2", "blocks.3.mlp.fc2.weight", [2048, 512], "bf16", "blocks.3", "mlp.fc2",
     ["F-DTYPE"], [
         ev("e-b3fc2-1", "curriculum-fold", 15408, ["F-CORPUS-0412", "R-CURRICULUM"],
            "counterpart of the first mlp fold"),
     ])
held("w-b7-qkv", "blocks.7.attn.qkv.weight", [512, 1536], "bf16", "blocks.7", "attn.qkv",
     ["F-DTYPE"], [
         ev("e-b7qkv-1", "learn-1", 18212, ["R-LEARN1", "O-PERPLX-431", "O-PERPLX-398"],
            "learn-1 chose the layer-7 attention candidate: cites the original choice and both perplexity observations"),
         ev("e-b7qkv-2", "reweight", 18388, ["A-OPERATOR-SAFETY", "A-PROVISIONAL-QKV"],
            "operator safety-slice reweight, provisional until ckpt-19000"),
         ev("e-b7qkv-3", "learn-1", 17968, ["R-LEARN1", "O-LOSS-SPIKE", "F-CORPUS-0413"],
            "learn-1 recovery choice after the loss spike"),
         ev("e-b7qkv-4", "equalize", 18401, ["C-EQUALIZE", "A-REVIEW-1842"],
            "equalization pass accepted by review 1842"),
     ])
held("w-b7-out", "blocks.7.attn.out.weight", [512, 512], "bf16", "blocks.7", "attn.out",
     ["F-DTYPE"], [
         ev("e-b7out-1", "equalize", 18401, ["C-EQUALIZE", "O-CHANEQ", "A-REVIEW-1842"],
            "equalization pass, conditioned on the channel-energy observation"),
         ev("e-b7out-2", "reweight", 18212, ["R-OPT-ADAMW"],
            "same step as the learned qkv seating"),
     ])
held("w-b7-fc1", "blocks.7.mlp.fc1.weight", [512, 2048], "bf16", "blocks.7", "mlp.fc1",
     ["F-DTYPE"], [
         ev("e-b7fc1-1", "curriculum-fold", 16032, ["F-CORPUS-0413", "R-CURRICULUM", "O-GRADNORM"],
            "tier-3 fold, scaled by the gradient observation"),
     ])
held("w-b7-fc2", "blocks.7.mlp.fc2.weight", [2048, 512], "bf16", "blocks.7", "mlp.fc2",
     ["F-DTYPE"], [
         ev("e-b7fc2-1", "reweight", 18176, ["F-CORPUS-0413", "R-OPT-ADAMW"],
            "second mlp reweight"),
     ])
held("w-b11-qkv", "blocks.11.attn.qkv.weight", [512, 1536], "bf16", "blocks.11", "attn.qkv",
     ["F-DTYPE"], [
         ev("e-b11qkv-1", "reweight", 18388, ["A-OPERATOR-SAFETY", "R-OPT-ADAMW"],
            "last block reweight, same approval as layer 7"),
     ])
held("w-b11-out", "blocks.11.attn.out.weight", [512, 512], "bf16", "blocks.11", "attn.out",
     ["F-DTYPE"], [
         ev("e-b11out-1", "reweight", 18388, ["A-OPERATOR-SAFETY", "R-OPT-ADAMW"],
            "last block output projection"),
     ])
held("w-b11-fc1", "blocks.11.mlp.fc1.weight", [512, 2048], "bf16", "blocks.11", "mlp.fc1",
     ["F-DTYPE"], [
         ev("e-b11fc1-1", "curriculum-fold", 16032, ["F-CORPUS-0413", "R-CURRICULUM"],
            "final mlp fold"),
     ])
held("w-b11-fc2", "blocks.11.mlp.fc2.weight", [2048, 512], "bf16", "blocks.11", "mlp.fc2",
     ["F-DTYPE"], [
         ev("e-b11fc2-1", "curriculum-fold", 16032, ["F-CORPUS-0413", "R-CURRICULUM"],
            "final mlp fold, output side"),
     ])
held("w-head-proj", "head.proj.weight", [32000, 512], "bf16", "head", "projection",
     ["F-TOKENIZER", "C-TIED-EMBED", "F-DTYPE"], [
         ev("e-head-1", "reweight", 14208, ["F-CORPUS-0413", "R-OPT-ADAMW"],
            "tied rows follow the embedding, this delta is the untied remainder"),
     ])
held("w-final-norm", "final.norm.weight", [512], "bf16", "head", "norm",
     ["F-DTYPE"], [
         ev("e-norm-1", "equalize", 18401, ["C-EQUALIZE"],
            "final scale equalized against the last block"),
     ])
derived("d-b7qkv-t", "blocks.7.attn.qkv.weight.transposed", [1536, 512], "bf16",
        "blocks.7", "attn.qkv.transposed",
        ["w-b7-qkv"], {"op": "transpose"}, [])
derived("d-b7qkv-i8", "blocks.7.attn.qkv.weight.int8_view", [1536, 512], "int8",
        "blocks.7", "attn.qkv.int8",
        ["d-b7qkv-t"], {"op": "quantize", "step": 3906}, ["C-QUANT"])
derived("d-b7fc1-f2", "blocks.7.mlp.fc1.weight.fold2", [512, 1024], "bf16",
        "blocks.7", "mlp.fc1.fold2",
        ["w-b7-fc1"], {"op": "fold2"}, [])
derived("d-b11out-s", "blocks.11.attn.out.weight.scaled", [512, 512], "bf16",
        "blocks.11", "attn.out.scaled",
        ["w-b11-out"], {"op": "scale", "p": 1, "q": 2}, ["C-EQUALIZE"])

# digests over canonical mock content
for p in P:
    p["digest"] = digest(p["id"], p["kind"], p["statement"])
for w in W:
    w["digest"] = digest(w["id"], w["name"], "x".join(str(d) for d in w["dims"]),
                         "x".join(str(v) for v in (w["anchor"]["values"] if w["anchor"] else [])))
for w in W:
    for e in w["events"]:
        e["weight"] = w["id"]
        e["digest"] = digest(e["id"], e["rule"], str(e["step"]),
                             "x".join(str(v) for v in e["delta"]))

seed = {
    "meta": {
        "product": "Wide",
        "surface": "weight-space explorer (prototype)",
        "session": "wide-session-8842",
        "checkpoint": "atlas-mini-l12 @ ckpt-18400",
        "epoch": 3,
        "clock": EVAL_CLOCK,
        "seed_label": "mock session, exact arithmetic, no compiler",
        "generator": "seedgen.py (deterministic, sha256)",
        "profile": "Idol core profile 1 (weights as first-class values)",
    },
    "premises": P,
    "weights": W,
}

with open("seed.json", "w") as f:
    json.dump(seed, f, indent=1)

print("premises", len(P), "weights", len(W),
      "events", sum(len(w["events"]) for w in W))
