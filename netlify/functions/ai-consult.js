function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_) {}
    }
    return null;
  }
}

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, {
      error: "Method Not Allowed",
      message: "Function is working. POST only."
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return jsonResponse(500, {
      error: "OPENAI_API_KEY is not set",
      message: "NetlifyのEnvironment variablesにOPENAI_API_KEYを設定してください。"
    });
  }

  let payload;

  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return jsonResponse(400, {
      error: "Invalid JSON",
      message: "送信データのJSON形式が不正です。"
    });
  }

  const schemaHint = {
    summaryTitle: "短いタイトル",
    friendlyNote: "生活者に寄り添う短い一言。診断断定はしない。",
    understood: ["AIが理解したことを3〜5項目"],
    missingInfo: ["追加で確認したいことを3〜5項目"],
    todayActions: ["今日やることを3項目。危険サインがあれば受診優先。"],
    selfCare: ["セルフケア案を3項目。生活状況に合わせる。"],
    otcDirection: "OTC候補の考え方。商品断定は避ける。",
    pharmacistCard: "薬剤師・医師に見せる自然文。要点が伝わるように。",
    connectionRecommendation: "薬局/医療機関/オンライン相談のどれにつなぐべきか。",
    safetyNote: "赤いサイン、緊急時、妊娠授乳・持病・併用薬の注意。"
  };

  const systemPrompt = [
    "あなたはOTC・セルフケア相談アプリのAI整理係です。",
    "",
    "役割：",
    "・診断や治療方針の断定はしない。",
    "・特定商品の購入を強く推奨しない。",
    "・生活者の曖昧な不安、症状、生活状況を整理する。",
    "・薬剤師、登録販売者、医師に伝えやすい相談カード文案を作る。",
    "・ユーザーの目的を尊重する。ただし危険サインがある場合は受診・救急相談を優先する。",
    "",
    "安全上の注意：",
    "・息苦しさ、胸痛、意識障害、突然の激しい痛み、しびれ、ろれつ異常、吐血、血便、黒色便、顔や唇の腫れ、全身じんましん、急激な悪化は医療相談を優先。",
    "・妊娠・授乳、小児、高齢者、持病、併用薬、NSAIDs喘息、成分重複は薬剤師または医師確認へつなげる。",
    "・OTCは成分カテゴリとして整理し、商品名の断定的推奨は避ける。",
    "",
    "文体：",
    "・生活者向けにはやさしく短く。",
    "・不安を一度受け止める。",
    "・薬剤師カードは具体的・簡潔に。",
    "",
    "出力形式：",
    "・必ずJSONだけを返す。",
    "・Markdown、説明文、コードブロックは不要。",
    "・JSONスキーマ例: " + JSON.stringify(schemaHint)
  ].join("\n");

  const requestBody = {
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: JSON.stringify({
          app_context: "薬局に行く前メモ+ AI v6",
          payload
        })
      }
    ],
    temperature: 0.2
  };

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    const data = await res.json();

    if (!res.ok) {
      return jsonResponse(500, {
        error: "OpenAI API error",
        status: res.status,
        detail: data
      });
    }

    let raw = "";

    if (typeof data.output_text === "string") {
      raw = data.output_text;
    } else if (Array.isArray(data.output)) {
      raw = data.output
        .flatMap(function(item) {
          return Array.isArray(item.content) ? item.content : [];
        })
        .map(function(content) {
          return content.text || "";
        })
        .join("\n");
    }

    const ai = safeParseJson(raw);

    if (!ai) {
      return jsonResponse(200, {
        ai: {
          summaryTitle: "AI整理",
          friendlyNote: "入力内容を整理しました。ただしJSON整形に失敗したため、原文中心のカードにします。",
          understood: [
            payload.freeText || payload.routeMemo || "自由入力なし"
          ],
          missingInfo: [
            "赤いサインの有無",
            "妊娠・授乳・持病・併用薬",
            "症状の期間と強さ"
          ],
          todayActions: [
            "赤いサインを確認する",
            "基本メモを確認する",
            "必要なら薬剤師・医師に相談する"
          ],
          selfCare: [
            "水分をとる",
            "無理せず休む",
            "悪化・長引く場合は相談する"
          ],
          otcDirection: "OTCは成分重複と避けたい条件を確認してから検討してください。",
          pharmacistCard: payload.freeText || payload.routeMemo || "相談内容を確認したいです。",
          connectionRecommendation: "相談カードを薬剤師・医師に見せてください。",
          safetyNote: "緊急時は119または医療機関へ。"
        },
        raw
      });
    }

    return jsonResponse(200, { ai });

  } catch (error) {
    return jsonResponse(500, {
      error: "Function fetch error",
      message: error && error.message ? error.message : String(error)
    });
  }
};
