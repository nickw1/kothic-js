var Kothic = {};

Kothic.render = (function() {

	var styleCache = {},
		pathOpened = false;

	function setStyles(ctx, styles) {
		for (var i in styles) {
			if (styles.hasOwnProperty(i) && styles[i]) {
				ctx[i] = styles[i];
			}
		}
	}

	function getStyle(feature, zoom) {
		var key = [MapCSS.currentStyle,
		           JSON.stringify(feature.properties),
		           zoom, feature.type].join(':'),
			type, selector;

		if (!styleCache[key]) {
			//TODO: propagate type and selector
			if (feature.type == 'Polygon' || feature.type == 'MultiPolygon') {
			    type = 'way';
			    selector = 'area';
			} else if (feature.type == 'LineString' || feature.type == 'MultiLineString') {
			    type = 'way';
			    selector = 'line';
			} else if (feature.type == 'Point' || feature.type == 'MultiPoint') {
			    type = 'node';
			    selector = 'node';
			}
			styleCache[key] = MapCSS.restyle(feature.properties, zoom, type, selector);
		}
		return styleCache[key];
	}

	function CollisionBuffer(ctx, debugBoxes, debugChecks) {
		this.buffer = [];

		// for debugging
		this.ctx = ctx;
		this.debugBoxes = debugBoxes;
		this.debugChecks = debugChecks;
	}

	CollisionBuffer.prototype = {
		addBox: function(box) {
			this.buffer.push(box);
		},

		addPointWH: function(point, w, h, d, id) {
			var box = this.getBoxFromPoint(point, w, h, d, id);

			this.buffer.push(box);

			if (this.debugBoxes) {
				this.ctx.save();
				this.ctx.strokeStyle = 'red';
				this.ctx.lineWidth = '1';
				this.ctx.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
				this.ctx.restore();
			}
		},

		checkBox: function(b) {
			for (var i = 0, len = this.buffer.length, c; i < len; i++) {
				c = this.buffer[i];

				// if it's the same object (only different styles), don't detect collision
				if (b[4] && (b[4] == c[4])) continue;

				if (c[0] <= b[2] && c[1] <= b[3] && c[2] >= b[0] && c[3] >= b[1]) {
					if (this.debugChecks) {
						this.ctx.save();
						this.ctx.strokeStyle = 'darkblue';
						this.ctx.lineWidth = '1';
						this.ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
						this.ctx.restore();
					}
					return true;
				}
			}
			return false;
		},

		checkPointWH: function(point, w, h, id) {
			return this.checkBox(this.getBoxFromPoint(point, w, h, 0, id));
		},

		getBoxFromPoint: function(point, w, h, d, id) {
			return [point[0] - w/2 - d,
			        point[1] - h/2 - d,
			        point[0] + w/2 + d,
			        point[1] + h/2 + d,
			        id];
		}
	};

	function renderBackground(ctx, width, height, zoom) {
		var style = MapCSS.restyle({}, zoom, "canvas")['default'];

		ctx.save();

		setStyles(ctx, {
			fillStyle: style["fill-color"],
			globalAlpha: style["fill-opacity"] || style.opacity
		});

		ctx.fillRect(-1, -1, width + 1, height + 1);

		ctx.restore();
	}

	function transformPoint(point, ws, hs, granularity) {
		return [ws * point[0], hs * (granularity - point[1])];
	}

	function renderPolygonFill(ctx, feature, nextFeature, ws, hs, granularity) {
		var style = feature.style;

		if (!pathOpened) {
			pathOpened = true;
			ctx.beginPath();
		}
		Kothic.path(ctx, feature, false, true, ws, hs, granularity);

		if (!nextFeature || (nextFeature.style !== style)) {
			ctx.save();
			var opacity = style["fill-opacity"] || style.opacity;

			if (('fill-color' in style)) {
				// first pass fills polygon with solid color
				setStyles(ctx, {
					fillStyle: style["fill-color"],
					globalAlpha: opacity
				});
				ctx.fill();
			}

			if ('fill-image' in style) {
				// second pass fills polygon with texture
				var image = MapCSS.getImage(style['fill-image']);
				if (image) {
					// texture image may not be loaded
					setStyles(ctx, {
						fillStyle: ctx.createPattern(image, 'repeat'),
						globalAlpha: opacity
					});
					ctx.fill();
				}
			}

			pathOpened = false;

			ctx.restore();
		}
	}

	function renderCasing(ctx, feature, nextFeature, ws, hs, granularity) {
		var style = feature.style;

		var dashes = style["casing-dashes"] || style.dashes || false;

		if (!pathOpened) {
			pathOpened = true;
			ctx.beginPath();
		}
		Kothic.path(ctx, feature, dashes, false, ws, hs, granularity);

		if (!nextFeature || (nextFeature.style !== style)) {
			ctx.save();

			setStyles(ctx, {
				lineWidth: 2 * style["casing-width"] + ("width" in style ? style["width"] : 0),
				strokeStyle: style["casing-color"] || style["color"],
				lineCap: style["casing-linecap"] || style["linecap"],
				lineJoin: style["casing-linejoin"] || style["linejoin"],
				globalAlpha: style["casing-opacity"] || style["opacity"]
			});

			pathOpened = false;
			ctx.stroke();
			ctx.restore();
		}
	}

	function renderPolyline(ctx, feature, nextFeature, ws, hs, granularity) {
		var style = feature.style;

		var dashes = style.dashes;

		if (!pathOpened) {
			pathOpened = true;
			ctx.beginPath();
		}
		Kothic.path(ctx, feature, dashes, false, ws, hs, granularity);

		if (!nextFeature || (nextFeature.style !== style)) {
			ctx.save();

			setStyles(ctx, {
				lineWidth: style.width,
				strokeStyle: style.color,
				lineCap: style.linecap,
				lineJoin: style.linejoin,
				globalAlpha: style.opacity
			});

			pathOpened = false;
			ctx.stroke();
			ctx.restore();
		}
	}

	function compareZIndexes(a, b) {
		return parseFloat(a.style["z-index"] || 0) - parseFloat(b.style["z-index"] || 0);
	}

	function extend(dest, source) {
		for (var i in source) {
			if (source.hasOwnProperty(i)) {
				dest[i] = source[i];
			}
		}
		return dest;
	}

	function styleFeatures(features, zoom) {
		var styledFeatures = [],
			i, j, len, feature, style, restyledFeature;

		for (i = 0, len = features.length; i < len; i++) {
			feature = features[i];
			style = getStyle(feature, zoom);

			for (j in style) {
				if (style.hasOwnProperty(j)) {
					restyledFeature = extend({}, feature);
					restyledFeature.kothicId = i;
					restyledFeature.style = style[j];
					styledFeatures.push(restyledFeature);
				}
			}
		}

		styledFeatures.sort(compareZIndexes);

		return styledFeatures;
	}

	function populateLayers(layers, layerIds, data, zoom) {
		var styledFeatures = styleFeatures(data.features, zoom);

		for (var i = 0, len = styledFeatures.length; i < len; i++) {
			var feature = styledFeatures[i],
				layerId = parseFloat(feature.properties.layer) || 0,
				layerStyle = feature.style["-x-mapnik-layer"];

			if (layerStyle == "top" ) {
				layerId = 10000;
			}
			if (layerStyle == "bottom" ) {
				layerId = -10000;
			}
			if (!(layerId in layers)) {
				layers[layerId] = [];
				layerIds.push(layerId);
			}
			layers[layerId].push(feature);
		}

		layerIds.sort();
	}

	function fontString(name, size) {
		name = name || '';
		size = size || 9;

		var family = name ? name + ', ' : '';

		name = name.toLowerCase();

		var styles = [];
		if (name.indexOf("italic") != -1 || name.indexOf("oblique") != -1) {
			styles.push('italic');
		}
		if (name.indexOf("bold") != -1) {
			styles.push('bold');
		}

		styles.push(size + 'px');

		if (name.indexOf('serif') != -1) {
			family += 'Georgia, serif';
		} else {
			family += 'Arial, Helvetica, sans-serif';
		}
		styles.push(family);

		return styles.join(' ');
	}

	function transformPoints(points, ws, hs, granularity) {
		var transformed = [];
		for (var i = 0, len = points.length; i < len; i++) {
			transformed.push(transformPoint(points[i], ws, hs, granularity));
		}
		return transformed;
	}

	function getReprPoint(feature) {
		var point;
		switch (feature.type) {
			case 'Point': point = feature.coordinates; break;
			case 'Polygon': point = feature.reprpoint; break;
			case 'LineString': point = feature.coordinates[0]; break;
			case 'GeometryCollection': //TODO: Disassemble geometry collection
			case 'MultiPoint': //TODO: Disassemble multi point
			case 'MultiPolygon': //TODO: Disassemble multi polygon
			case 'MultiLineString': return; //TODO: Disassemble multi line string
		}
		return point;
	}

	function renderTextIconOrBoth(ctx, feature, collides, ws, hs, granularity, renderText, renderIcon) {
		var style = feature.style,
			reprPoint = getReprPoint(feature);

		if (!reprPoint) return;

		var point = transformPoint(reprPoint, ws, hs, granularity),
			img;
		
		if (renderIcon) {
			img = MapCSS.getImage(style["icon-image"]);
			if (!img) return;
			if (collides.checkPointWH(point, img.width, img.height, feature.kothicId)) return;
		}
		
		if (renderText) {
			ctx.save();
	
			setStyles(ctx, {
				lineWidth: style["text-halo-radius"] + 2,
				font: fontString(style["font-family"], style["font-size"])
			});
	
			var text = style['text'] + '',
				textWidth = ctx.measureText(text).width,
				letterWidth = textWidth / text.length,
				collisionWidth = textWidth,
				collisionHeight = letterWidth * 2.5,
				offset = style["text-offset"] || 0;
	
			if ((style["text-allow-overlap"] != "true") &&
					collides.checkPointWH([point[0], point[1] + offset], collisionWidth, collisionHeight, feature.kothicId)) {
				ctx.restore();
				return;
			}
	
			var opacity = style["text-opacity"] || style["opacity"] || 1,
				fillStyle = style["text-color"] || "#000000",
				strokeStyle = style["text-halo-color"] || "#ffffff",
				halo = ("text-halo-radius" in style);
	
			if (opacity < 1){
				fillStyle = new RGBColor(fillStyle, opacity).toRGBA();
				strokeStyle = new RGBColor(strokeStyle, opacity).toRGBA();
			}
	
			setStyles(ctx, {
				fillStyle: fillStyle,
				strokeStyle: strokeStyle,
				textAlign: 'center',
				textBaseline: 'middle'
			});
	
			if (feature.type == "Polygon" || feature.type == "Point") {
	
				if (halo) ctx.strokeText(text, point[0], point[1] + offset);
				ctx.fillText(text, point[0], point[1] + offset);
	
				var padding = parseFloat(style["-x-mapnik-min-distance"]) || 20;
				collides.addPointWH([point[0], point[1] + offset], collisionWidth, collisionHeight, padding, feature.kothicId);
	
			} else if (feature.type == 'LineString') {
	
				var points = transformPoints(feature.coordinates, ws, hs, granularity);
				Kothic.textOnPath(ctx, points, text, halo, collides);
			}
	
			ctx.restore();
		}
		
		if (renderIcon) {
			ctx.drawImage(img,
					Math.floor(point[0] - img.width / 2),
					Math.floor(point[1] - img.height / 2));
			
			var padding = parseFloat(style["-x-mapnik-min-distance"]) || 0;

			collides.addPointWH(point, img.width, img.height, padding, feature.kothicId);
		}
	}

	function getDebugInfo(start, layersStyled, mapRendered, finish) {
		return (layersStyled - start) + ': layers styled<br />' +
				(mapRendered - layersStyled) + ': map rendered<br />' +
				(finish - mapRendered) + ': icons/text rendered<br />' +
				(finish - start) + ': total<br />';
	}


	return function(canvasId, data, zoom, onRenderComplete, buffered) {

		var canvas, ctx,
			buffer, realCtx,
			width, height,
			granularity,
			ws, hs,
			layers = {},
			layerIds = [],
			collides;

		var start = +new Date(),
			layersStyled,
			mapRendered,
			finish;

		// init all variables

		canvas = (typeof canvasId == 'string' ? document.getElementById(canvasId) : canvasId);
		width = canvas.width;
		height = canvas.height;
		ctx = canvas.getContext('2d');

		if (buffered) {
			realCtx = ctx;
			buffer = document.createElement('canvas');
			buffer.width = width;
			buffer.height = height;
			ctx = buffer.getContext('2d');
		}

		granularity = data.granularity;
		ws = width / granularity;
		hs = height / granularity;

		collides = new CollisionBuffer(/*ctx, true*/);
		collides.addBox([0, 0, width, 0]);
		collides.addBox([0, height, width, height]);
		collides.addBox([width, 0, width, height]);
		collides.addBox([0, 0, 0, height]);

		// style and populate layer structures

		populateLayers(layers, layerIds, data, zoom);

		layersStyled = +new Date();

		// render

		setStyles(ctx, {
			strokeStyle: "rgba(0,0,0,0.5)",
			fillStyle: "rgba(0,0,0,0.5)",
			lineWidth: 1,
			lineCap: "round",
			lineJoin: "round"
		});

		var layersLen = layerIds.length,
			i, j, features, featuresLen, style;

		var renderMap, renderIconsAndText;

		renderMap = function() {
			renderBackground(ctx, width, height, zoom);

			for (i = 0; i < layersLen; i++) {

				features = layers[layerIds[i]];
				featuresLen = features.length;

				for (j = 0; j < featuresLen; j++) {
					style = features[j].style;
					if (('fill-color' in style) || ('fill-image' in style)) {
						renderPolygonFill(ctx, features[j], features[j+1], ws, hs, granularity);
					}
				}

				ctx.lineCap = "butt";

				for (j = 0; j < featuresLen; j++) {
					if ("casing-width" in features[j].style) {
						renderCasing(ctx, features[j], features[j+1], ws, hs, granularity);
					}
				}
				ctx.lineCap = "round";

				for (j = 0; j < featuresLen; j++) {
					if ("width" in features[j].style) {
						renderPolyline(ctx, features[j], features[j+1], ws, hs, granularity);
					}
				}

				mapRendered = +new Date();
			}

			setTimeout(renderIconsAndText, 0);
		};

		renderIconsAndText = function() {

			for (i = layersLen - 1; i >= 0; i--) {

				features = layers[layerIds[i]];
				featuresLen = features.length;

				// render icons without text
				for (j = featuresLen - 1; j >= 0; j--) {
					style = features[j].style;
					if (("icon-image" in style) && !style["text"]) {
						renderTextIconOrBoth(ctx, features[j], collides, ws, hs, granularity, false, true);
					}
				}
				
				// render text on paths
				for (j = featuresLen - 1; j >= 0; j--) {
					style = features[j].style;
					if (style["text"] && style["text-position"] == 'line') {
						renderTextIconOrBoth(ctx, features[j], collides, ws, hs, granularity, true, false);
					}
				}

				// render horizontal text on features without icons
				for (j = featuresLen - 1; j >= 0; j--) {
					style = features[j].style;
					if (style["text"] && style["text-position"] != 'line' && !("icon-image" in style)) {
						renderTextIconOrBoth(ctx, features[j], collides, ws, hs, granularity, true, false);
					}
				}

				// for features with both icon and text, render both or neither
				for (j = featuresLen - 1; j >= 0; j--) {
					style = features[j].style;
					if (("icon-image" in style) && style["text"]) {
						renderTextIconOrBoth(ctx, features[j], collides, ws, hs, granularity, true, true);
					}
				}
			}

			finish = +new Date();

			if (buffered) {
				realCtx.drawImage(buffer, 0, 0);
			}

			onRenderComplete(getDebugInfo(start, layersStyled, mapRendered, finish));
		};

		setTimeout(renderMap, 0);
	};
}());