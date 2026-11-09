
export default {
  async fetch(request, env) {
    // عرض ملفات واجهة التطبيق من مجلد public
    if (!env.ASSETS) {
      return new Response(
        "Erreur: ASSETS binding غير مضبوط في wrangler.toml",
        { status: 500 }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
