(function () {
  "use strict";
  if (!window.AcardEditor || !window.DoriDBViews) return;
  window.DoriDBViews.chart = function (ctx) {
    var root = ctx.doc.createElement("div");
    root.setAttribute("role", "status");
    root.textContent = "차트를 불러오는 중…";
    window.AcardEditor.lazy("chart").then(function (chart) {
      root.removeAttribute("role");
      root.replaceChildren(chart.render(ctx));
    }).catch(function () { root.textContent = "차트를 불러오지 못했어요."; });
    return root;
  };
})();
