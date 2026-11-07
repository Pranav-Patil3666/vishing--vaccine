import { type ScenarioDocument } from "./scenario.js";
import {
  authoredIntensities, draftBehaviors, draftOutcomes, DraftAuthoringError, MockDraftBriefSchema,
  outcomeFor, tacticCategories, type AuthoringCandidate, type MockDraftBrief,
} from "./phase6Draft.js";

export interface ScenarioDraftGenerator {
  generateDraft(brief: MockDraftBrief): AuthoringCandidate;
}

export const benefitsTemplate = {
  family: "fictional-benefits-verification",
  version: "1.0.0",
  generatorVersion: "1.0.0",
} as const;

export function parseMockDraftBrief(value: unknown): MockDraftBrief {
  if (value && typeof value === "object" && "templateFamily" in value && "templateVersion" in value
    && (value.templateFamily !== benefitsTemplate.family || value.templateVersion !== benefitsTemplate.version)) {
    throw new DraftAuthoringError("UNSUPPORTED_TEMPLATE");
  }
  const parsed = MockDraftBriefSchema.safeParse(value);
  if (!parsed.success) throw new DraftAuthoringError("INVALID_AUTHORING_BRIEF");
  const brief = parsed.data;
  if (brief.redFlags && (new Set(brief.redFlags).size !== flags.length
    || brief.redFlags.length !== flags.length || !flags.every((flag) => brief.redFlags!.includes(flag.id)))) {
    throw new DraftAuthoringError("INVALID_AUTHORING_BRIEF", "redFlags");
  }
  return { ...brief, redFlags: flags.map((flag) => flag.id) };
}

const organization = "Fictional Meghdoot Works";
const flags = [
  { id: "RF-01", title: "Artificial deadline", description: "The caller makes the practice decision sound time-limited.", tactics: ["urgency"], safeAction: "Take time to check the practice request." },
  { id: "RF-02", title: "Claimed approval", description: "A desk name, queue, or supervisor is offered as proof of identity.", tactics: ["authority"], safeAction: "Use the fictional employee directory you already know." },
  { id: "RF-03", title: "Isolation", description: "The caller suggests keeping the training request away from colleagues.", tactics: ["isolation"], safeAction: "Consult the established training desk through your own channel." },
  { id: "RF-07", title: "Threatened consequence", description: "A delay, hold, or removal is presented as a consequence of pausing.", tactics: ["fear"], safeAction: "Verify the stated consequence independently before deciding." },
  { id: "RF-08", title: "Reward bait", description: "A practice perk is linked to accepting the request on the call.", tactics: ["reward"], safeAction: "Decline the offer until the familiar training channel confirms it." },
] as const;

type Tactic = keyof typeof tacticCategories;
type Localized = readonly [latin: string, devanagari: string];
const opening: Localized = [
  "Yeh simulation hai. Main fictional Meghdoot Works ke benefits desk se bol raha hoon. Practice wellness enrollment ki ek confirmation pending hai. Kya abhi baat kar sakte hain?",
  "यह सिमुलेशन है। मैं काल्पनिक मेघदूत वर्क्स के बेनिफिट्स डेस्क से बोल रहा हूँ। अभ्यास वाले वेलनेस नामांकन की पुष्टि बाकी है। क्या अभी बात कर सकते हैं?",
];

const lines: Record<Tactic, readonly [Localized, Localized, Localized]> = {
  urgency: [
    ["Meghdoot ki practice wellness list aaj review ho rahi hai. Kya aap apna decision jaldi bata sakte hain?",
      "मेघदूत की अभ्यास वाली वेलनेस सूची आज देखी जा रही है। क्या आप अपना फैसला जल्दी बता सकते हैं?"],
    ["Meghdoot ke practice wellness form ka aaj ka batch band hone wala hai. Main is call mein hi aapka jawab note kar loon?",
      "मेघदूत के अभ्यास वाले वेलनेस फ़ॉर्म का आज का बैच बंद होने वाला है। मैं इसी कॉल पर आपका जवाब लिख लूँ?"],
    ["Meghdoot ke practice wellness slot par timer chal raha hai. Agli baat se pehle mujhe haan ya na chahiye.",
      "मेघदूत के अभ्यास वाले वेलनेस स्लॉट पर समय चल रहा है। आगे बढ़ने से पहले मुझे हाँ या ना चाहिए।"],
  ],
  authority: [
    ["Meghdoot benefits desk mein yeh practice wellness request mere naam par aayi hai. Aap meri baat par status confirm kar sakte hain.",
      "मेघदूत बेनिफिट्स डेस्क में यह अभ्यास वाली वेलनेस रिक्वेस्ट मेरे नाम आई है। आप मेरी बात पर स्थिति की पुष्टि कर सकते हैं।"],
    ["Meghdoot ki practice wellness queue mein supervisor ne mere liye approval mark kiya hai. Isi call par confirmation de dijiye.",
      "मेघदूत की अभ्यास वाली वेलनेस कतार में सुपरवाइज़र ने मेरे लिए मंज़ूरी दर्ज की है। इसी कॉल पर पुष्टि कर दीजिए।"],
    ["Meghdoot ki practice wellness list ka final sign-off mere desk ke paas hai. Mere kehne par confirmation kar dijiye.",
      "मेघदूत की अभ्यास वाली वेलनेस सूची की अंतिम मंज़ूरी मेरे डेस्क के पास है। मेरे कहने पर पुष्टि कर दीजिए।"],
  ],
  isolation: [
    ["Meghdoot ki practice wellness entry pehle hum dono dekh lete hain. Team ko baad mein batayenge.",
      "मेघदूत की अभ्यास वाली वेलनेस एंट्री पहले हम दोनों देख लेते हैं। टीम को बाद में बताएँगे।"],
    ["Meghdoot ke is practice wellness review ka zikr abhi group mein mat kijiye. Pehle mujhe yahin jawab de dijiye.",
      "मेघदूत के इस अभ्यास वाले वेलनेस रिव्यू का ज़िक्र अभी ग्रुप में मत कीजिए। पहले मुझे यहीं जवाब दे दीजिए।"],
    ["Meghdoot ki is practice wellness call mein kisi aur desk ko mat jodiye. Main aapse akele mein confirmation chahta hoon.",
      "मेघदूत की इस अभ्यास वाली वेलनेस कॉल में किसी और डेस्क को मत जोड़िए। मैं आपसे अकेले में पुष्टि चाहता हूँ।"],
  ],
  fear: [
    ["Meghdoot ki practice wellness confirmation aaj na mili toh entry agle review tak pending reh sakti hai.",
      "मेघदूत की अभ्यास वाली वेलनेस पुष्टि आज न मिली तो एंट्री अगले रिव्यू तक बाकी रह सकती है।"],
    ["Meghdoot ki practice wellness entry ko hold par rakhne ka note hai. Aap abhi confirm kar dein toh main note hata sakta hoon.",
      "मेघदूत की अभ्यास वाली वेलनेस एंट्री रोकने का नोट है। आप अभी पुष्टि कर दें तो मैं नोट हटा सकता हूँ।"],
    ["Meghdoot ke practice wellness round mein bina jawab wali entry list se hat sakti hai. Kya main abhi aapki haan likh doon?",
      "मेघदूत के अभ्यास वाले वेलनेस राउंड में बिना जवाब वाली एंट्री सूची से हट सकती है। क्या मैं अभी आपकी हाँ लिख दूँ?"],
  ],
  reward: [
    ["Meghdoot ke practice wellness form ki confirmation par ek demo participation badge mil sakta hai.",
      "मेघदूत के अभ्यास वाले वेलनेस फ़ॉर्म की पुष्टि पर एक डेमो भागीदारी बैज मिल सकता है।"],
    ["Meghdoot ke practice wellness round mein jo isi call par haan bolte hain, unke liye demo workshop ki pehli choice hai.",
      "मेघदूत के अभ्यास वाले वेलनेस राउंड में जो इसी कॉल पर हाँ बोलते हैं, उनके लिए डेमो वर्कशॉप की पहली पसंद है।"],
    ["Meghdoot ka practice wellness bonus badge isi call ki confirmation ke saath milne ka offer hai. Kya aap ise lena chahenge?",
      "मेघदूत का अभ्यास वाला वेलनेस बोनस बैज इसी कॉल की पुष्टि के साथ मिलने का ऑफ़र है। क्या आप इसे लेना चाहेंगे?"],
  ],
};

const endings: Record<typeof draftOutcomes[number] | "system", Localized> = {
  SAFE_VERIFIED: ["Aapne apna jaana-pehchana channel chuna. Meghdoot ki practice call yahin khatam hai.",
    "आपने अपना जाना-पहचाना चैनल चुना। मेघदूत की अभ्यास कॉल यहीं खत्म है।"],
  DUMMY_SECRET_DISCLOSED: ["Demo token bol diya gaya. Meghdoot ki practice call yahin rokte hain. Agli baar kisi caller ko asli value na batayein.",
    "डेमो टोकन बोल दिया गया। मेघदूत की अभ्यास कॉल यहीं रोकते हैं। अगली बार किसी कॉलर को असली जानकारी न बताएँ।"],
  SAFE_FALLBACK: ["Jawab clear nahi tha. Meghdoot ki practice call yahin rokte hain. Apne known channel se jaanch karein.",
    "जवाब साफ़ नहीं था। मेघदूत की अभ्यास कॉल यहीं रोकते हैं। अपने जाने-पहचाने चैनल से जाँच करें।"],
  MAX_TURNS: ["Meghdoot ki practice call ki turn limit poori ho gayi. Koi confirmation zaroori nahi hai. Ab debrief dekhein.",
    "मेघदूत की अभ्यास कॉल की बारी सीमा पूरी हो गई। कोई पुष्टि ज़रूरी नहीं है। अब समीक्षा देखें।"],
  system: ["Yeh practice call ab khatam hai. Agla kadam lene se pehle known channel se check karein.",
    "यह अभ्यास कॉल अब खत्म है। अगला कदम लेने से पहले जाने-पहचाने चैनल से जाँच करें।"],
};

type Example = readonly [utterance: string, interpretation: string];
const examplesByBehavior: Record<typeof draftBehaviors[number], readonly [Example, Example, Example]> = {
  REFUSED: [
    ["मैं वेलनेस नामांकन की पुष्टि इस कॉल पर नहीं करूँगी।", "Declines to confirm enrollment on the call."],
    ["Nahi, Meghdoot ki entry par meri haan mat likhiye.", "Rejects consent to record agreement."],
    ["I won't share a practice token on this call.", "Refuses to share a token without claiming verification."],
  ],
  STALLED: [
    ["वेलनेस वाली बात समझने के लिए थोड़ा समय चाहिए।", "Asks for time to understand the request."],
    ["Wellness form par abhi jawab mat likhiye, main baad mein soch kar bataunga.", "Defers the decision."],
    ["Give me a minute to find my notes about this practice round.", "Pauses to check notes without independently verifying."],
  ],
  VERIFIED_INDEPENDENTLY: [
    ["मैं मेघदूत की पहले से जानती हुई कर्मचारी डायरेक्टरी से पुष्टि करूँगी।", "Chooses a familiar employee directory."],
    ["Caller ke contact se nahi, main apne saved training desk se wellness entry verify karunga.", "Names an independently saved contact."],
    ["I'll open the training portal from my own bookmark and verify this enrollment there.", "Uses a channel independent of the caller."],
  ],
  COMPLIED: [
    ["ठीक है, मेरी वेलनेस एंट्री की पुष्टि लिख लीजिए।", "Agrees to confirmation without disclosing a token."],
    ["Aap mere liye practice wellness slot select kar dijiye.", "Accepts the caller's suggested slot selection."],
    ["Yes, go ahead and mark me down for that practice workshop.", "Assents to a workshop action without sharing a token."],
  ],
  DISCLOSED_DUMMY_SECRET: [
    ["मेरे अभ्यास कार्ड पर DUMMY-1234 लिखा है।", "Says the synthetic value printed on a practice card."],
    ["Wellness round mein mera demo token DUMMY-2048 hai.", "Volunteers a synthetic practice token."],
    ["I can read out the example for this exercise: DUMMY-4720.", "Reads a different explicitly synthetic value aloud."],
  ],
  UNKNOWN: [
    ["आज बाहर बहुत बारिश हो रही है।", "Unrelated weather comment gives no usable decision."],
    ["Wellness list mein kitne column hote hain?", "Asks about format without agreeing, pausing, or verifying."],
    ["The title sounds familiar.", "Acknowledges familiarity without expressing an action."],
  ],
};

const safeActions = [
  "Pause before confirming any enrollment or benefit.",
  "Decline to provide private information or even a practice token to an unexpected caller.",
  "Check the enrollment in a familiar fictional employee directory or bookmarked training portal.",
  "End the simulation whenever the request is unclear or you want to stop.",
];

const debrief = [
  ["verified", "VERIFIED_INDEPENDENTLY", "SAFE_VERIFIED", "safe", "RF-02",
    "Learner ne apne known channel ka zikr kiya. Caller ki pehchaan ka daava khud proof nahi tha.",
    "Credit independent verification only when the learner names a channel they already know.",
    "Open the familiar employee directory yourself before confirming enrollment.",
    "A stated plan does not establish that an external check was completed.",
    "A familiar channel separates the decision from the caller's claimed approval."],
  ["refused", "REFUSED", null, "safe", "RF-03",
    "Learner ne call par action se mana kiya. Isse caller ki one-to-one request accept nahi hui.",
    "Record an explicit refusal only when the learner states it.",
    "End the call if the caller insists and check the request separately.",
    "Refusal alone does not establish independent verification.",
    "A caller cannot require you to keep a training request private."],
  ["stalled", "STALLED", null, "safe", "RF-01",
    "Learner ne jawab dene se pehle waqt maanga. Practice deadline ke bawajood turant confirmation nahi di.",
    "Record a requested pause. Do not infer recognition from response latency.",
    "Use the pause to look up the training desk through a familiar source.",
    "A pause alone does not establish what the learner noticed.",
    "A practice deadline leaves room for an independent check."],
  ["dummy", "DISCLOSED_DUMMY_SECRET", "DUMMY_SECRET_DISCLOSED", "risky", "RF-02",
    "Learner ne practice token bola. Yeh observation sirf synthetic value ke baare mein hai.",
    "Record synthetic disclosure only when the structured behavior identifies the dummy pattern.",
    "On the next call, decline to read a token and verify the request elsewhere.",
    "This records a practice action and makes no claim about real credential exposure.",
    "A caller's asserted authority cannot authorize token disclosure."],
  ["fallback", "UNKNOWN", "SAFE_FALLBACK", "unknown", "RF-03",
    "Is jawab se learner ka decision clear nahi tha. Practice call bina aur pressure ke khatam hui.",
    "Leave action-specific points unscored when the behavior is UNKNOWN.",
    "End the call and check the enrollment through a familiar channel.",
    "An ambiguous reply cannot establish intent, compliance, or refusal.",
    "An unclear request can be stopped without making a decision."],
  ["limit", null, "MAX_TURNS", "unknown", "RF-07",
    "Practice ki turn limit poori hui. Debrief mein sirf darj decisions ko dekhein.",
    "Record bounded completion. Score verification or refusal only if present in committed events.",
    "Review the enrollment separately before acting.",
    "Reaching the turn cap does not imply acceptance of the caller's claim.",
    "The practice can end while a decision is still open."],
] as const;

export class DeterministicMockScenarioGenerator implements ScenarioDraftGenerator {
  generateDraft(brief: MockDraftBrief): AuthoringCandidate {
    const localeIndex = brief.scriptPreference === "Latin" ? 0 : 1;
    const flagsForDraft = flags.map((flag) => ({ ...flag, tactics: [...flag.tactics] }));
    const redFlags = flagsForDraft.map((flag) => flag.id);
    const objective = brief.learningObjective === "verify-through-known-channel"
      ? "Verify a fictional employee benefits request through a channel you already know."
      : "Pause before confirming a fictional employee benefits request and check it independently.";
    const variants = flags.flatMap((flag) => authoredIntensities.map((intensity, index) => {
      const tactic = flag.tactics[0];
      return {
        responseId: `${tactic}.${intensity}`, tactic, intensity, pressureLevel: index + 1,
        script: brief.scriptPreference, redFlags: [flag.id],
        educationalPurpose: `Recognize ${flag.title.toLowerCase()} in the ${intensity}-intensity wellness call example.`,
        text: lines[tactic][index]![localeIndex],
      };
    }));
    const terminalResponses = {
      SAFE_VERIFIED: "ending.verified", DUMMY_SECRET_DISCLOSED: "ending.dummy",
      SAFE_FALLBACK: "system.safe-fallback", MAX_TURNS: "ending.turn-limit",
    };
    const openingResponseId = "system.opening";
    const systemEnding = "system.safe-ending";
    const responses: ScenarioDocument["responses"] = {
      [openingResponseId]: { text: opening[localeIndex], safety_status: "draft" },
      ...Object.fromEntries(variants.map((item) => [item.responseId, { text: item.text, safety_status: "draft" }])),
      ...Object.fromEntries(draftOutcomes.map((outcome) => [terminalResponses[outcome], {
        text: endings[outcome][localeIndex], safety_status: outcome === "SAFE_FALLBACK" ? "system_safe_template" : "draft",
      }])),
      [systemEnding]: { text: endings.system[localeIndex], safety_status: "system_safe_template" },
    };
    const choices = [
      { nodeId: "opening-decision", responseId: openingResponseId, flag: "RF-01", cue: "thoda samay chahiye",
        context: "Decide whether to confirm the practice enrollment on an unexpected call." },
      { nodeId: "authority-decision", responseId: "authority.medium", flag: "RF-02", cue: "abhi confirm nahi karunga",
        context: "Consider whether the claimed supervisor approval independently establishes identity." },
      { nodeId: "consequence-decision", responseId: "fear.medium", flag: "RF-07", cue: "pehle dekh leta hoon",
        context: "Decide whether an alleged hold changes your plan to check through a familiar channel." },
    ] as const;
    const points = choices.slice(0, brief.maxLearnerTurns);
    const scenario: ScenarioDocument = {
      scenario_id: brief.scenarioId, version: brief.draftVersion, lifecycle_status: "DRAFT",
      language: brief.language, voice_id: null, fictional_organization: { name: organization, training_only: true },
      simulation: true, opening_line: opening[localeIndex], learning_objectives: [objective],
      red_flag_ids: redFlags, responses,
      nodes: points.map((point, index) => ({
        id: point.nodeId, parent_node_id: points[index - 1]?.nodeId ?? null,
        next_node_id: points[index + 1]?.nodeId ?? null, response_id: point.responseId,
        trigger_rules: index === 0 ? [] : [{ type: "normalized_text", text: point.cue }],
        learner_expected_behavior: [safeActions[2]!], safe_fallback_response_id: "system.safe-fallback",
        debrief_tags: [point.flag], safety_constraints: ["Fictional simulation with synthetic examples only."], branch_status: "draft",
      })),
      adaptive_policy: {
        max_pressure_level: 3, max_turns: brief.maxLearnerTurns, safe_word: "stop simulation",
        escalation_behaviors: ["COMPLIED"],
        terminal_states: [...draftOutcomes, "SAFE_WORD", "LEARNER_ENDED"],
        tactics: variants.map((item) => ({
          tactic_id: item.responseId, category: tacticCategories[item.tactic], pressure_level: item.pressureLevel,
          response_ids: [item.responseId], prompts_dummy_secret: false,
          behavior_targets: ["REFUSED", "STALLED", "COMPLIED"],
        })),
      },
      safety_metadata: {
        visible_simulation_label: true, ai_voice_disclosure_required: true, consent_before_recording: true,
        audio_retention: "none_by_default", dummy_data_mode: "synthetic_only", safe_ending_response_id: systemEnding,
      },
      safety_constraints: ["Use fictional benefits requests and synthetic practice data.", "End the simulation on the safe word or learner stop."],
      review_status: "draft", reviewed_by: null, reviewed_at: null,
    };
    const examples = draftBehaviors.flatMap((label) => examplesByBehavior[label].map(([utterance, interpretation], index) => ({
      example: {
        exampleId: `${label.toLowerCase().replaceAll("_", "")}.${index + 1}`, utterance, label,
        language: (["hi", "hi-en", "en"] as const)[index]!,
        split: (["train", "validation", "held_out_test"] as const)[index]!,
        source: "synthetic" as const, redactionReviewed: true as const,
      },
      interpretation, script: index === 0 ? "Devanagari" as const : "Latin" as const,
      decision: outcomeFor(label) ?? "continue" as const,
    })));
    const trainingExamples = examples.map(({ example }) => example);
    return {
      schemaVersion: 1,
      draft: {
        packageId: `${brief.scenarioId}-${brief.draftVersion}-draft`, status: "DRAFT",
        source: "offline_authoring", target: "offline_pre_generated",
        scenarioBrief: { scenarioId: brief.scenarioId, learningObjective: objective, redFlags, language: brief.language },
        scenario,
        tacticPool: variants.map((item) => ({
          tacticId: item.responseId, category: tacticCategories[item.tactic], pressureLevel: item.pressureLevel,
          responseIds: [item.responseId], status: "DRAFT",
        })),
        candidateApprovedResponses: Object.entries(responses).map(([responseId, item]) => ({
          responseId, text: item.text, language: brief.language, status: "DRAFT",
        })),
        behaviorTrainingExamples: trainingExamples, candidateUtterances: trainingExamples,
        debriefTemplateVariants: debrief.map(([templateId, , , kind, , text]) => ({
          templateId, language: brief.language, kind, text, status: "DRAFT",
        })),
        importableArtifacts: [{ artifactId: `${brief.scenarioId}-${brief.draftVersion}-scenario`, format: "scenario-json", scenario }],
        review: {
          decision: "pending", reviewerId: null, reviewedAt: null, notes: [],
          checklist: {
            fictionalOrganization: false, syntheticDataOnly: false, noSecurityBypassInstructions: false,
            safeEndingAvailable: false, simulationLabelVisible: false, aiVoiceDisclosureRequired: false,
            consentBeforeRecording: false, noAudioRetentionByDefault: false,
          },
        },
        runtimeEligible: false,
      },
      details: {
        title: brief.title, department: "Employee Benefits Practice Desk", industry: "Fictional workplace benefits",
        audience: brief.audience, difficulty: brief.difficulty,
        premise: "A caller claims a wellness enrollment is pending at Fictional Meghdoot Works. The employee chooses whether to confirm on the call or check the request independently.",
        register: "Conversational Hindi/Hinglish with familiar workplace terms", scriptPreference: brief.scriptPreference,
        safeActions: [...safeActions], openingResponseId,
        variants: variants.map(({ text: _text, ...item }) => item),
        redFlags: flagsForDraft,
        examples: examples.map(({ example, ...item }) => ({ ...item, exampleId: example.exampleId })),
        decisionPoints: points.map((point, index) => ({
          nodeId: point.nodeId, turn: index + 1, context: point.context,
          routes: draftBehaviors.map((behavior) => {
            const next = points[index + 1];
            const terminal = !next && behavior === "UNKNOWN" ? "MAX_TURNS" : outcomeFor(behavior);
            return terminal || !next
              ? { behavior, action: "terminal", outcome: terminal ?? "MAX_TURNS" }
              : { behavior, action: "continue", nextNodeId: next.nodeId };
          }),
        })),
        terminalResponses,
        stopGuidance: "Learner End and the safe word stop the simulation immediately without another learner window.",
        debriefs: debrief.map(([templateId, behavior, outcome, , flag, , scoring, nextAction, limitations, takeaway]) => ({
          templateId, behavior, outcome, redFlags: [flag], scoring, nextAction, limitations, takeaway,
        })),
      },
    };
  }
}
