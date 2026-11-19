/* Shared WORLD CONTROL binder. Works on world.html and on the desktop world layer. */
(function () {
  var root = document.getElementById("worldControls") || document.getElementById("desktopWorldControls");
  if (!root) return;

  var slider = root.querySelector("#timeSlider");
  var timeLabel = root.querySelector("#timeLabel");
  var weatherLabel = root.querySelector("#weatherLabel");
  var state = root.querySelector("#controlState");
  var timeChips = root.querySelector("#timeChips");
  var weatherChips = root.querySelector("#weatherChips");
  var weatherNames = { clear: "CLEAR", cloudy: "CLOUDY", rain: "RAIN", storm: "STORM", snow: "SNOW", fog: "FOG" };
  var toggle = root.querySelector("#controlToggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var collapsed = root.classList.toggle("is-collapsed");
      toggle.textContent = collapsed ? "显示" : "隐藏";
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }

  function fmt(minutes) {
    var h = Math.floor(minutes / 60) % 24;
    var m = Math.round(minutes % 60);
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  function markWeather(value) {
    [].forEach.call(weatherChips.querySelectorAll("button"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-weather") === value);
    });
  }

  function sync() {
    var api = window.AEVUM_WORLD_CONTROL;
    if (!api) return false;
    var s = api.getState();
    var minutes = Math.round(s.time * 1440) % 1440;
    slider.value = String(minutes);
    timeLabel.textContent = fmt(minutes);
    weatherLabel.textContent = weatherNames[s.weather] || s.weather.toUpperCase();
    state.textContent = "READY";

    var best = null, bestDist = Infinity;
    [].forEach.call(timeChips.querySelectorAll("button"), function (b) {
      var d = Math.abs(Number(b.getAttribute("data-time")) - minutes);
      if (d < bestDist) { bestDist = d; best = b; }
    });
    [].forEach.call(timeChips.querySelectorAll("button"), function (b) {
      b.classList.toggle("is-active", b === best);
    });
    markWeather(s.weather);
    return true;
  }

  function setTime(minutes) {
    var api = window.AEVUM_WORLD_CONTROL;
    if (!api) return;
    api.setTime(Number(minutes) / 1440);
    sync();
  }

  function setWeather(name) {
    var api = window.AEVUM_WORLD_CONTROL;
    if (!api) return;
    api.setWeather(name);
    sync();
  }

  slider.addEventListener("input", function () { setTime(slider.value); });
  timeChips.addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-time]");
    if (b) setTime(b.getAttribute("data-time"));
  });
  weatherChips.addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-weather]");
    if (b) setWeather(b.getAttribute("data-weather"));
  });

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (sync() || tries > 80) clearInterval(timer);
  }, 250);
  sync();
})();
