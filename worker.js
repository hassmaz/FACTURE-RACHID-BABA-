
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "استعمل POST لإرسال صورة الفاتورة" },
        { status: 405, headers: cors }
      );
    }

    try {
      if (!env["CLÉ_API_OPENAI"]) {
        throw new Error("مفتاح OpenAI غير مضبوط");
      }

      const form = await request.formData();
      const photo = form.get("image");

      if (!photo || typeof photo.arrayBuffer !== "function") {
        throw new Error("لم يتم إرسال صورة الفاتورة");
      }

      if (!photo.type.startsWith("image/")) {
        throw new Error("الملف المرسل ليس صورة");
      }

      const bytes = new Uint8Array(await photo.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }

      const image = `data:${photo.type};base64,${btoa(binary)}`;

      const response = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env["CLÉ_API_OPENAI"]}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            input: [{
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `اقرأ هذه الفاتورة المكتوبة بخط اليد بالعربية أو الفرنسية.
استخرج المعلومات بدقة وأعد JSON فقط بهذا الشكل:
{
 "seller":"",
 "customer":"",
 "invoice_number":"",
 "date":"",
 "items":[
  {"description":"","quantity":0,"unit_price":0,"total":0}
 ],
 "subtotal":0,
 "tax":0,
 "total":0,
 "currency":"MAD",
 "notes":""
}
لا تخترع المعلومات غير المقروءة. ضع null عند تعذر القراءة.`
                },
                {
                  type: "input_image",
                  image_url: image,
                  detail: "high"
                }
              ]
            }]
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error?.message || "تعذر تحليل الفاتورة"
        );
      }

      const output = result.output
        ?.flatMap(item => item.content || [])
        ?.find(item => item.type === "output_text")
        ?.text;

      if (!output) {
        throw new Error("لم يتم استخراج بيانات الفاتورة");
      }

      return Response.json(
        { success: true, data: JSON.parse(output) },
        { headers: cors }
      );

    } catch (error) {
      return Response.json(
        { success: false, error: error.message },
        { status: 500, headers: cors }
      );
    }
  }
};
 
