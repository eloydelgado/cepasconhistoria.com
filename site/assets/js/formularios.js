/*
 * Formularios de contacto para la copia estática (GitHub Pages).
 *
 * Sustituye el envío de Contact Form 7 (que necesita WordPress) por validación
 * en el navegador + la Cloud Function `contactoWeb` del proyecto Firebase
 * grupodelgado-prod (la misma que usa delgadoseleccion.com), que guarda la
 * solicitud y la envía por correo. La llamada va protegida con App Check
 * (reCAPTCHA Enterprise), que se carga al empezar a rellenar un formulario.
 *
 * Formularios de esta web:
 *   - Fichas de vino («Incluye … en tu carta»): nombre, correo, mensaje,
 *     ¿particular o empresa? y aceptación de la política de privacidad.
 *   - Artículos del blog: nombre, correo y aceptación.
 * (El popup de newsletter es de Mailchimp y no pasa por aquí.)
 *
 * CONFIGURACIÓN
 *   recaptchaSiteKey: clave de sitio de reCAPTCHA Enterprise registrada en App Check.
 *                     Debe tener el dominio cepasconhistoria.com en su lista de dominios.
 *                     Si se deja vacía, al enviar se abre el programa de correo
 *                     del visitante con el mensaje ya redactado (mailto) a fallbackEmail.
 */
(function () {
	'use strict';

	var CONFIG = {
		recaptchaSiteKey: '6LdxFSMuAAAAAA0ImKsJQ0ge1lWmgDTuso1crLmH',
		firebase: {
			apiKey: 'AIzaSyAUxsnbJHWXhgpdf8-WrlsZqg3YR6K56zY',
			authDomain: 'grupodelgado-prod.firebaseapp.com',
			projectId: 'grupodelgado-prod',
			appId: '1:372017317721:web:3558356a66cd5fc5166e48'
		},
		region: 'europe-west1',
		functionName: 'contactoWeb',
		sdk: 'https://www.gstatic.com/firebasejs/11.0.2/',
		siteName: 'Cepas con Historia',
		fallbackEmail: 'info@cepasconhistoria.com'
	};

	var MSG = {
		required: 'El campo es obligatorio.',
		acceptance: 'Debes aceptar los términos y condiciones antes de enviar tu mensaje.',
		email: 'La dirección de correo electrónico no es válida.',
		tel: 'El número de teléfono no es válido.',
		pattern: 'El formato del campo no es válido.',
		invalid: 'Uno o más campos tienen un error. Por favor, revísalos e inténtalo de nuevo.',
		sent: 'Gracias por tu mensaje. Ha sido enviado.',
		failed: 'Hubo un error intentando enviar tu mensaje. Por favor, inténtalo de nuevo más tarde.',
		mailto: 'Se ha abierto tu programa de correo con el mensaje preparado. Pulsa «Enviar» en él para completar el envío.'
	};

	var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	var TEL_RE = /^[+0-9\s().\-]{6,}$/;

	function clean(s) {
		return (s || '').replace(/\s+/g, ' ').trim();
	}

	/* ---------- Descripción de campos ----------
	 * Contact Form 7 en esta web usa dos formas:
	 *   <p><label> Nombre<br><span class="wpcf7-form-control-wrap">control</span></label></p>
	 *   <p>¿Eres particular o empresa?<br><span class="wpcf7-form-control-wrap">radios</span></p>
	 * La etiqueta es el texto del <p> que no pertenece al control.
	 */
	function labelFor(wrap) {
		var p = wrap.closest('p') || wrap.parentNode;
		var copy = p.cloneNode(true);
		var inner = copy.querySelector('.wpcf7-form-control-wrap');
		if (inner) inner.remove();
		return clean(copy.textContent).replace(/[:*]+$/, '').replace(/\s*\(opcional\)$/i, '').trim();
	}

	function cf7Fields(form) {
		var out = [];
		form.querySelectorAll('.wpcf7-form-control-wrap').forEach(function (wrap) {
			var radios = wrap.querySelectorAll('input[type=radio]');
			var el = radios.length ? radios[0] : wrap.querySelector('input, select, textarea');
			if (!el) return;
			var isAcceptance = !!wrap.querySelector('.wpcf7-acceptance');
			out.push({
				el: el,
				group: radios.length ? Array.prototype.slice.call(radios) : null,
				wrap: wrap,
				label: isAcceptance ? 'Política de privacidad' : labelFor(wrap) || el.name,
				required: isAcceptance || el.getAttribute('aria-required') === 'true' ||
					!!wrap.querySelector('[aria-required="true"]'),
				kind: isAcceptance ? 'acceptance' : radios.length ? 'radio' : el.type === 'email' ? 'email' : el.type === 'tel' ? 'tel' : 'text'
			});
		});
		return out;
	}

	function valueOf(field) {
		if (field.kind === 'acceptance') return field.el.checked ? 'Aceptada' : 'No aceptada';
		if (field.group) {
			var checked = field.group.filter(function (r) { return r.checked; })[0];
			return checked ? checked.value : '';
		}
		return field.el.value.trim();
	}

	function validate(field) {
		var filled = field.kind === 'acceptance' ? field.el.checked : valueOf(field) !== '';
		if (field.required && !filled) return field.kind === 'acceptance' ? MSG.acceptance : MSG.required;
		if (field.kind === 'acceptance' || field.group || !filled) return '';
		var v = valueOf(field);
		if (field.kind === 'email' && !EMAIL_RE.test(v)) return MSG.email;
		if (field.kind === 'tel' && !TEL_RE.test(v)) return MSG.tel;
		var pattern = field.el.getAttribute('pattern');
		if (pattern && !new RegExp('^(?:' + pattern + ')$').test(v)) return field.el.getAttribute('title') || MSG.pattern;
		return '';
	}

	/* ---------- Envío ---------- */

	// Lo que recibe la Cloud Function contactoWeb (mismo formato que delgadoseleccion.com).
	function buildPayload(fields) {
		var email = '';
		var campos = fields.map(function (f) {
			var valor = valueOf(f);
			if (f.kind === 'email' && !email) email = valor;
			return { etiqueta: f.label, valor: valor };
		});
		var h1 = '';
		var h1El = document.querySelector('h1');
		if (h1El) { // los <br> del título («Espinela<br>Roble») cuentan como espacio
			var copy = h1El.cloneNode(true);
			copy.querySelectorAll('br').forEach(function (br) { br.replaceWith(' '); });
			h1 = clean(copy.textContent);
		}
		return {
			formulario: CONFIG.siteName + ' – ' + (h1 || document.title),
			pagina: location.href,
			email: email,
			campos: campos
		};
	}

	// Carga Firebase + App Check una sola vez (módulos ES desde gstatic).
	var callablePromise = null;
	function getCallable() {
		if (!callablePromise) {
			callablePromise = Promise.all([
				import(CONFIG.sdk + 'firebase-app.js'),
				import(CONFIG.sdk + 'firebase-app-check.js'),
				import(CONFIG.sdk + 'firebase-functions.js')
			]).then(function (m) {
				var app = m[0].initializeApp(CONFIG.firebase, 'contacto-web');
				m[1].initializeAppCheck(app, {
					provider: new m[1].ReCaptchaEnterpriseProvider(CONFIG.recaptchaSiteKey),
					isTokenAutoRefreshEnabled: true
				});
				return m[2].httpsCallable(m[2].getFunctions(app, CONFIG.region), CONFIG.functionName);
			});
			callablePromise.catch(function () { callablePromise = null; });
		}
		return callablePromise;
	}

	function send(data) {
		if (!CONFIG.recaptchaSiteKey) {
			var body = data.campos.map(function (c) { return c.etiqueta + ': ' + c.valor; }).join('\n');
			location.href = 'mailto:' + CONFIG.fallbackEmail +
				'?subject=' + encodeURIComponent('Formulario web: ' + data.formulario) +
				'&body=' + encodeURIComponent(body);
			return Promise.resolve('mailto');
		}
		return getCallable().then(function (call) {
			return call(data);
		}).then(function () {
			return 'sent';
		});
	}

	// No se usa form.reset() ni se lanzan eventos "change": Contact Form 7 los
	// escucha y vuelve a validar (o llama a WordPress), y taparía el mensaje de éxito.
	function clearFields(form, fields) {
		var acceptance = false;
		fields.forEach(function (f) {
			if (f.group) f.group.forEach(function (r) { r.checked = false; });
			else if (f.el.type === 'checkbox') f.el.checked = false;
			else if (f.el.tagName === 'SELECT') f.el.selectedIndex = 0;
			else f.el.value = '';
			if (f.kind === 'acceptance') acceptance = true;
		});
		// Como hace Contact Form 7: sin aceptar la política, el botón queda desactivado.
		var button = form.querySelector('.wpcf7-submit');
		if (acceptance && button) button.disabled = true;
	}

	/* ---------- Interfaz Contact Form 7 ---------- */

	function cf7Status(form, status, message) {
		form.classList.remove('init', 'invalid', 'sent', 'failed', 'submitting', 'validating', 'resetting');
		form.classList.add(status);
		form.setAttribute('data-status', status);
		var out = form.querySelector('.wpcf7-response-output');
		if (out) {
			out.textContent = message || '';
			out.setAttribute('aria-hidden', message ? 'false' : 'true');
		}
		var sr = form.closest('.wpcf7') && form.closest('.wpcf7').querySelector('.screen-reader-response p');
		if (sr) sr.textContent = message || '';
	}

	function cf7ClearErrors(form) {
		form.querySelectorAll('.wpcf7-not-valid-tip').forEach(function (t) { t.remove(); });
		form.querySelectorAll('.wpcf7-not-valid').forEach(function (el) {
			el.classList.remove('wpcf7-not-valid');
			el.setAttribute('aria-invalid', 'false');
		});
	}

	function handleCf7(form) {
		var fields = cf7Fields(form);
		cf7ClearErrors(form);
		var firstBad = null;
		fields.forEach(function (f) {
			var err = validate(f);
			if (!err) return;
			var target = f.kind === 'acceptance' || f.group ? f.wrap.querySelector('.wpcf7-form-control') : f.el;
			target.classList.add('wpcf7-not-valid');
			f.el.setAttribute('aria-invalid', 'true');
			var tip = document.createElement('span');
			tip.className = 'wpcf7-not-valid-tip';
			tip.setAttribute('aria-hidden', 'true');
			tip.textContent = err;
			f.wrap.appendChild(tip);
			firstBad = firstBad || f.el;
		});
		if (firstBad) {
			cf7Status(form, 'invalid', MSG.invalid);
			firstBad.focus();
			return;
		}
		var button = form.querySelector('.wpcf7-submit');
		if (button) button.disabled = true;
		cf7Status(form, 'submitting', '');
		form.classList.add('init'); // mantiene el estilo base mientras envía
		send(buildPayload(fields)).then(function (result) {
			if (button) button.disabled = false;
			if (result === 'sent') clearFields(form, fields);
			cf7Status(form, 'sent', result === 'mailto' ? MSG.mailto : MSG.sent);
		}, function (err) {
			if (button) button.disabled = false;
			if (window.console) console.error('[formularios] Error al enviar:', err);
			cf7Status(form, 'failed', MSG.failed);
		});
	}

	/* ---------- Enganche ----------
	 * Se escucha en fase de captura sobre window para adelantarse al manejador
	 * de Contact Form 7, que intentaría enviar a WordPress.
	 */
	window.addEventListener('submit', function (e) {
		var form = e.target;
		if (!(form instanceof HTMLFormElement) || !form.matches('.wpcf7-form')) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		// Campo trampa antispam de Akismet: si lo rellena un bot, fingimos éxito.
		var hp = form.querySelector('[name="_wpcf7_ak_hp_textarea"]');
		if (hp && hp.value) {
			cf7Status(form, 'sent', MSG.sent);
			return;
		}
		handleCf7(form);
	}, true);

	// Precarga Firebase y reCAPTCHA al empezar a rellenar un formulario, para
	// que App Check tenga su token listo al enviar (y no cargarlo en cada visita).
	window.addEventListener('focusin', function (e) {
		if (CONFIG.recaptchaSiteKey && e.target.closest && e.target.closest('.wpcf7-form')) {
			getCallable().catch(function () {});
		}
	});

	// Quita los avisos de error al corregir un campo.
	window.addEventListener('input', clearOne, true);
	window.addEventListener('change', clearOne, true);
	function clearOne(e) {
		var el = e.target;
		if (!el.closest || !el.closest('.wpcf7-form')) return;
		el.classList.remove('wpcf7-not-valid');
		var wrap = el.closest('.wpcf7-form-control-wrap');
		if (wrap) {
			var tip = wrap.querySelector('.wpcf7-not-valid-tip');
			if (tip) tip.remove();
			var ctl = wrap.querySelector('.wpcf7-not-valid');
			if (ctl) ctl.classList.remove('wpcf7-not-valid');
		}
		el.setAttribute('aria-invalid', 'false');
	}
})();
