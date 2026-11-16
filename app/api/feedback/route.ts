export const runtime = "edge";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    grade: { type: "string", description: "A concise indicative grade in the requested grading format." },
    gradeRationale: { type: "string", description: "One concise sentence explaining the overall grade." },
    aiUseProbability: { type: "integer", minimum: 0, maximum: 100, description: "Estimated probability from 0 to 100 that generative AI contributed materially to producing the submitted report." },
    noticed: { type: "string", description: "40–70 words acknowledging the work as a whole, using a brief quote or precise reference, focused mainly on evaluative strengths." },
    whyMark: { type: "string", description: "40–70 words explaining what the student did well, explicitly linked to supplied criteria or standard quantitative report criteria, without mentioning any mark, grade, percentage, classification or band." },
    improve: { type: "string", description: "40–70 words of specific, actionable feedforward identifying where and how to improve." },
  },
  required: ["grade", "gradeRationale", "aiUseProbability", "noticed", "whyMark", "improve"],
};

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "The site owner needs to add the OpenAI API key before feedback can be generated." }, { status: 503 });

    const form = await request.formData();
    const file = form.get("report");
    if (!(file instanceof File)) return Response.json({ error: "Please upload a report." }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return Response.json({ error: "Please choose a file smaller than 20 MB." }, { status: 400 });

    const allowedExtensions = ["pdf", "doc", "docx", "rtf", "odt", "txt", "md"];
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!allowedExtensions.includes(extension)) return Response.json({ error: "Please upload a PDF, Word, RTF, OpenDocument or text file." }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const mime = file.type || (extension === "pdf" ? "application/pdf" : "application/octet-stream");
    const fileData = `data:${mime};base64,${btoa(binary)}`;
    const scheme = String(form.get("scheme") || "UK university percentage");
    const level = String(form.get("level") || "Undergraduate");
    const criteria = String(form.get("criteria") || "").trim();
    const criteriaFile = form.get("criteriaFile");
    let criteriaFileContent: { type: "input_file"; filename: string; file_data: string } | null = null;
    if (criteriaFile instanceof File && criteriaFile.size > 0) {
      if (criteriaFile.size > 10 * 1024 * 1024) return Response.json({ error: "Please choose a marking-criteria file smaller than 10 MB." }, { status: 400 });
      const criteriaExtension = criteriaFile.name.split(".").pop()?.toLowerCase() || "";
      if (!allowedExtensions.includes(criteriaExtension)) return Response.json({ error: "Please upload marking criteria as a PDF, Word, RTF, OpenDocument or text file." }, { status: 400 });
      const criteriaBytes = new Uint8Array(await criteriaFile.arrayBuffer());
      let criteriaBinary = "";
      for (let i = 0; i < criteriaBytes.length; i += 0x8000) criteriaBinary += String.fromCharCode(...criteriaBytes.subarray(i, i + 0x8000));
      const criteriaMime = criteriaFile.type || (criteriaExtension === "pdf" ? "application/pdf" : "application/octet-stream");
      criteriaFileContent = { type: "input_file", filename: criteriaFile.name, file_data: `data:${criteriaMime};base64,${btoa(criteriaBinary)}` };
    }

    const instructions = `You are an experienced university lecturer assessing a quantitative research report at ${level} level. Give fair, evidence-based feedback in UK English. Assess the accuracy and clarity of the abstract; rationale and use of literature; hypotheses; appropriateness and reporting of design, participants, materials and procedure; statistical analysis and APA-style reporting; interpretation of results; quality and critical depth of the discussion; limitations; conclusions; structure and academic communication.\n\nReturn an indicative grade using: ${scheme}. ${criteria || criteriaFileContent ? `Prioritise the supplied marking criteria or learning outcomes.${criteria ? ` Pasted criteria:\n${criteria}` : ""}` : "Use standard university criteria for a quantitative research report."}\n\nRequirements:\n- Base every judgement only on the uploaded report. Do not invent content.\n- The grade must be realistic and discriminating, not automatically generous.\n- Each of the three feedback sections must contain 40–70 words.\n- “I noticed about your work…” should acknowledge the whole piece and highlight good evaluative practice using one short quote (no more than 12 words) or a precise reference to a specific section. Focus mainly on substance, not proofreading.\n- “What you did well…” must explain the report's strengths and explicitly connect them to the supplied criteria or relevant quantitative-report criteria.\n- In all three written feedback sections, never mention or repeat the mark, grade, percentage, classification, degree class, outcome or performance band. Keep all grading information exclusively in the separate indicative-grade fields.\n- “To improve your work…” must give concrete feedforward: identify a specific part of the report, explain what stronger critical analysis or reporting would look like, and say what the student should do next. Never merely say “needs more critical analysis”.\n- Distinguish shortcomings in the report from missing information.\n- Do not address the student by name and do not use bullet points inside the three sections.`;

    const aiUseInstructions = `\n\nAI-use estimate:\n- Return an integer from 0 to 100 for aiUseProbability. Estimate whether generative AI contributed materially to producing the report using multiple textual signals such as unusually uniform style, generic or formulaic phrasing, shallow specificity, fabricated or unverifiable references, abrupt changes in voice, and inconsistencies across the work.\n- Also weigh evidence against AI use, including specific reasoning, authentic source engagement and a consistent individual voice.\n- Do not treat polished grammar, vocabulary, structure or high attainment by themselves as evidence of AI use.\n- Treat this as an uncertain pattern-based estimate, not proof.`;

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-terra",
        instructions: instructions + aiUseInstructions,
        input: [{ role: "user", content: [{ type: "input_file", filename: file.name, file_data: fileData, ...(extension === "pdf" ? { detail: "low" } : {}) }, ...(criteriaFileContent ? [criteriaFileContent] : []), { type: "input_text", text: criteriaFileContent ? "The first file is the student report. The second file contains the marking criteria. Use those criteria as the primary basis for the grade and feedback." : "Assess this report and return the requested feedback." }] }],
        text: { format: { type: "json_schema", name: "report_feedback", strict: true, schema } },
      }),
    });

    const result = await apiResponse.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>; error?: { message?: string } };
    if (!apiResponse.ok) throw new Error(result.error?.message || "The assessment service returned an error.");
    const outputText = result.output_text || result.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("No feedback was returned. Please try again.");
    const feedback = JSON.parse(outputText) as Record<string, string>;
    for (const key of ["noticed", "whyMark", "improve"]) {
      const words = countWords(feedback[key] || "");
      if (words < 35 || words > 80) throw new Error("The feedback did not meet the required length. Please generate it again.");
    }
    const usage = result as { id?: string; usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number } };
    const tokens = usage.usage?.total_tokens ?? ((usage.usage?.input_tokens ?? 0) + (usage.usage?.output_tokens ?? 0));
    return Response.json(feedback, { headers: { "x-openai-response-id": usage.id ?? "", "x-openai-total-tokens": String(tokens) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Feedback could not be generated.";
    return Response.json({ error: message }, { status: 500 });
  }
}
