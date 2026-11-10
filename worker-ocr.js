
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    const jsonResponse = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...cors,
          "Content-Type": "application/json; charset=utf-8"
        }
      });

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { success: false, error: "استعمل POST لإرسال صورة الفاتورة" },
        405
      );
    }

    try {
      if (!env.GEMINI_API_KEY) {
        throw new Error("مفتاح Gemini غير مضبوط في Cloudflare Secrets");
      }

      const form = await request.formData();
      const photo = form.get("image");

      if (!photo || typeof photo.arrayBuffer !== "function") {
        throw new Error("لم يتم إرسال صورة الفاتورة");
      }

      if (!photo.type || !photo.type.startsWith("image/")) {
        throw new Error("الملف المرسل ليس صورة");
      }

      const bytes = new Uint8Array(await photo.arrayBuffer());

      if (bytes.length > 15 * 1024 * 1024) {
        throw new Error("حجم الصورة كبير جداً. اختر صورة أصغر من 15 ميغابايت");
      }

      let binary = "";
      const chunkSize = 0x8000;

      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(
          ...bytes.subarray(i, i + chunkSize)
        );
      }

      const base64 = btoa(binary);

      const prompt = `
أنت متخصص في قراءة الفواتير التجارية المكتوبة بخط اليد.
مهمتك قراءة الصورة كاملة واستخراج جميع البيانات بدقة.

الفاتورة قد تكون مكتوبة بالعربية أو الفرنسية أو بهما معاً.

تعليمات إلزامية:

1. اقرأ جميع أسطر جدول الفاتورة من الأعلى إلى الأسفل.
2. اهتم بأسماء المواد والبضائع اهتماماً خاصاً.
3. لا تهمل أي سطر، حتى إذا كان الاسم صعب القراءة.
4. لا تستبدل أسماء المواد بأسماء من عندك.
5. لا تخمن الكلمات أو الأرقام غير الواضحة.
6. إذا تعذر قراءة اسم مادة، ضع null في description.
7. حافظ على ترتيب الأسطر كما تظهر في الصورة.
8. اقرأ الكمية وثمن الوحدة ومجموع كل سطر بشكل مستقل.
9. لا تخلط بين ثمن الوحدة والمجموع.
10. استخرج اسم البائع والزبون ورقم الفاتورة والتاريخ إن كانت ظاهرة.
11. تحقق من أن مجموع الأسطر يطابق المجموع العام.
12. إذا وجدت اختلافاً حسابياً، اذكره في notes ولا تغير الأرقام الأصلية.
13. لا تحذف الأسطر المكررة.
14. لا تضف أسطراً غير موجودة.

أعد JSON صالحاً فقط، دون أي شرح خارجه، بهذا الشكل:

{
  "seller": null,
  "customer": null,
  "invoice_number": null,
  "date": null,
  "items": [
    {
      "description": null,
      "quantity": null,
      "unit_price": null,
      "total": null
    }
  ],
  "subtotal": null,
  "tax": null,
  "total": null,
  "currency": "MAD",
  "notes": ""
}

تأكد من إدراج كل أسطر جدول المواد.
استعمل الأرقام فقط للقيم الحسابية.
إذا كانت قيمة غير مقروءة، استعمل null.
`;

      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  {
                    inline_data: {
                      mime_type: photo.type,
                      data: base64
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json",
              maxOutputTokens: 8192
            }
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error?.message || "تعذر الاتصال بمحرك Gemini"
        );
      }

      const output = result.candidates
        ?.flatMap(candidate => candidate.content?.parts || [])
        ?.map(part => part.text || "")
        ?.join("")
        ?.trim();

      if (!output) {
        throw new Error("لم يرجع Gemini أي بيانات. أعد المحاولة بصورة أوضح");
      }

      const cleaned = output
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      let data;

      try {
        data = JSON.parse(cleaned);
      } catch {
        throw new Error("تعذر تحويل نتيجة القراءة إلى بيانات منظمة");
      }

      if (!Array.isArray(data.items)) {
        throw new Error("لم يتم العثور على جدول المواد في النتيجة");
      }

      return jsonResponse({
        success: true,
        data
      });

    } catch (error) {
      return jsonResponse({
        success: false,
        error: error.message || "حدث خطأ أثناء استخراج الفاتورة"
      }, 500);
    }
  }
};
