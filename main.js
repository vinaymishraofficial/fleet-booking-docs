// Copyright (c) 2025, Alfastack Solution Private Limited and contributors
// For license information, please see license.txt

// ----------------------------------- Auto Filled Logged IN Employee Details ---------------------

frappe.ui.form.on('Employee Fleet Booking Request', {
    onload: function(frm) {
        if (!frm.doc.employee_id) {
            // Get Employee linked to current user
            frappe.db.get_list('Employee', {
                filters: { 'user_id': frappe.session.user },
                limit: 1
            }).then(emp_list => {
                if(emp_list.length > 0) {
                    frm.set_value('employee_id', emp_list[0].name);
                }
            });
        }
        // Securely fetch Google Maps API key via custom method (no DocType read permission needed)
        frappe.call({
            method: 'fleet_booking.api.get_google_maps_key',
            callback: function(r){
                if(r.message){
                    frm.google_map_api_key = r.message;
                } else {
                    console.warn('No Google Maps key returned');
                }
            }
        });
        // Hide google_map_api_key field for non-privileged roles if it exists on the form (prevent employee edits)
        if(frm.fields_dict && frm.fields_dict.google_map_api_key){
            const privileged = frappe.user.has_role('System Manager') || frappe.user.has_role('Fleet Manager');
            if(!privileged){
                frm.set_df_property('google_map_api_key','hidden',1);
                frm.set_df_property('google_map_api_key','read_only',1);
            }
        }
    }
});

// ----------------------------------------------------------------Map Working Script ---------------

frappe.ui.form.on('Employee Fleet Booking Request', {
    onload(frm) {
        console.log('Employee Fleet Booking Request: onload');
        // Wait for API key to be loaded
        function injectGoogleMapsScript() {
            if (!frm.google_map_api_key) {
                setTimeout(injectGoogleMapsScript, 200);
                return;
            }
            if (!window.google || !window.google.maps) {
                console.log('→ Injecting Google Maps script');
                const script = document.createElement('script');
                script.src =
                    'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(frm.google_map_api_key) + '&libraries=places&callback=initVehicleMaps';
                script.async = true;
                document.head.appendChild(script);
            } else {
                console.log('→ Google Maps already loaded, calling initVehicleMaps');
                initVehicleMaps();
            }
        }
        injectGoogleMapsScript();
    },
    refresh(frm) {
        console.log('Employee Fleet Booking Request: refresh');
        if (window.google && window.google.maps) {
            console.log('→ Maps ready on refresh, drawing full route');
            renderFullTripRoute(frm);
        } else {
            console.log('→ Maps not yet ready on refresh');
        }
    },
    mode_selector(frm) {
        // When mode changes, re-render the route and update duration
        if (window.google && window.google.maps) {
            renderFullTripRoute(frm);
        }
    },
    // Remove stopover-after-drop check to avoid duplicate error
    validate(frm) {
        // ...existing code if any...
        // (No need to check for stopover after drop here)
    }
});

// Prevent stopover after drop at child row type selection
frappe.ui.form.on('Fleet Request Routes', {
    type(frm, cdt, cdn) {
        const child = locals[cdt][cdn];
        const trip_plan = frm.doc.trip_plan || [];
        const idx = trip_plan.findIndex(r => r.name === child.name);
        const currentType = (child.type || '').toLowerCase();

        // Prevent any type after drop/end
        for (let i = 0; i < idx; i++) {
            const prevType = (trip_plan[i].type || '').toLowerCase();
            if (prevType === 'drop' || prevType === 'end') {
                frappe.model.set_value(cdt, cdn, 'type', ''); // Reset type
                frappe.throw('Trip ends at Drop. To add more, please create a new trip request.');
                return; // Prevent duplicate message
            }
        }
    }
});

window.initVehicleMaps = function () {
    console.log('initVehicleMaps: Maps API loaded');
    // Bind autocomplete on any Fleet Request Routes address input
    $(document).on('focus', 'input[data-fieldname="address"]', function () {
        const $input = $(this);
        if ($input.data('gmaps-bound')) {
            return;
        }
        $input.data('gmaps-bound', true);
        console.log('• Binding Autocomplete to input', this);

        const ac = new google.maps.places.Autocomplete(this);
        ac.addListener('place_changed', () => {
            console.log('↳ place_changed event');
            const place = ac.getPlace();
            if (!place.geometry) {
                frappe.msgprint(`No details for '${place.name}'`);
                return;
            }

            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            console.log('→ Got coords:', lat, lng);

            // locate the child row
            const $row = $input.closest('.grid-row');
            const rowIdx = $row.attr('data-idx');
            const child = cur_frm.doc.trip_plan.find(r => String(r.idx) === String(rowIdx));
            if (!child) {
                console.error('! Could not find child for idx', rowIdx);
                return;
            }
            const cdn = child.name;

            // set address field value to selected place's formatted address or name
            const addressValue = place.formatted_address || place.name || '';
            frappe.model.set_value('Fleet Request Routes', cdn, 'address', addressValue);

            // save to child
            frappe.model.set_value('Fleet Request Routes', cdn, 'latitude', lat);
            frappe.model.set_value('Fleet Request Routes', cdn, 'longitude', lng);

            // mini-map
            const $mapCell = $row.find('td[data-fieldname="map_view"] .html-content');
            if ($mapCell.length) {
                $mapCell.html(`<div id="mini-map-${cdn}" style="height:200px;"></div>`);
                new google.maps.Map(
                    document.getElementById(`mini-map-${cdn}`),
                    { center: { lat, lng }, zoom: 14 }
                );
            }

            // redraw full route (and recalc distance/duration)
            renderFullTripRoute(cur_frm);
        });
    });
};

function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    let parts = [];
    if (hrs > 0) parts.push(`${hrs} hour${hrs > 1 ? 's' : ''}`);
    if (mins > 0 || hrs === 0) parts.push(`${mins} min`);
    return parts.join(' ');
}

function renderFullTripRoute(frm) {
    const pts = frm.doc.trip_plan || [];
    const wrap = frm.fields_dict.trip_view.$wrapper;

    if (pts.length < 2) {
        wrap.empty();
        frm.set_value('trip_distance', 0);
        frm.set_value('trip_duration', '');
        return;
    }

    wrap.html(`<div id="full-route-map" style="height:400px;width:100%"></div>`);

    let origin, destination;
    const waypts = [];

    pts.forEach((r, i) => {
        const lat = parseFloat(r.latitude),
            lng = parseFloat(r.longitude),
            ll = new google.maps.LatLng(lat, lng);

        if (i === 0) origin = ll;
        else if (i === pts.length - 1) destination = ll;
        else waypts.push({ location: ll, stopover: true });
    });

    // Get travel mode from mode_selector field, default to DRIVING
    let travelMode = google.maps.TravelMode.DRIVING;
    if (frm.doc.mode_selector) {
        const mode = frm.doc.mode_selector.toUpperCase();
        if (google.maps.TravelMode[mode]) {
            travelMode = google.maps.TravelMode[mode];

        }
    }

    const map = new google.maps.Map(
        document.getElementById('full-route-map'),
        { center: origin, zoom: 7 }
    );
    const ds = new google.maps.DirectionsService();

    ds.route({
        origin,
        destination,
        waypoints: waypts,
        travelMode: travelMode,
        provideRouteAlternatives: true
    }, (res, status) => {
        if (status === 'OK') {
            // Remove previous polylines if any
            if (window._routePolylines) {
                window._routePolylines.forEach(p => p.setMap(null));
            }
            window._routePolylines = [];

            // --- Always select the shortest route by default, regardless of mode ---
            let selectedIdx = 0;
            let minDistance = Infinity;
            res.routes.forEach((route, idx) => {
                let meters = 0;
                route.legs.forEach(leg => {
                    meters += leg.distance.value;
                });
                // Only consider routes with valid distance
                if (meters > 0 && meters < minDistance) {
                    minDistance = meters;
                    selectedIdx = idx;
                }
            });
            // If user has manually selected a route, use that
            if (frm.selectedRouteIdx !== undefined) selectedIdx = frm.selectedRouteIdx;

            res.routes.forEach((route, idx) => {
                const color = idx === selectedIdx ? '#1976D2' : '#757575';
                const opacity = idx === selectedIdx ? 0.9 : 0.5;
                const polyline = new google.maps.Polyline({
                    path: route.overview_path,
                    strokeColor: color,
                    strokeOpacity: opacity,
                    strokeWeight: 6,
                    map: map,
                    zIndex: idx === selectedIdx ? 2 : 1
                });
                polyline.routeIdx = idx;
                polyline.addListener('click', function () {
                    frm.selectedRouteIdx = idx;
                    renderFullTripRoute(frm);
                });
                window._routePolylines.push(polyline);
            });

            // --- Marker logic for Pickup, Stopover, Drop, Transit ---
            if (window._routeMarkers) {
                window._routeMarkers.forEach(m => m.setMap(null));
            }
            window._routeMarkers = [];

            // InfoWindow instance (reuse for all markers)
            if (!window._markerInfoWindow) {
                window._markerInfoWindow = new google.maps.InfoWindow();
            }
            const infoWindow = window._markerInfoWindow;

            pts.forEach((point, i) => {
                let markerIcon, markerLabel, markerTitle;
                const type = (point.type || '').toLowerCase();
                if (type === 'pickup') {
                    markerIcon = { url: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png" };
                    markerLabel = "P";
                    markerTitle = "Pickup";
                } else if (type === 'stopover') {
                    markerIcon = { url: "http://maps.google.com/mapfiles/ms/icons/orange-dot.png" };
                    markerLabel = "S";
                    markerTitle = "Stopover";
                } else if (type === 'drop' || type === 'end') {
                    markerIcon = { url: "http://maps.google.com/mapfiles/ms/icons/green-dot.png" };
                    markerLabel = "D";
                    markerTitle = "Drop";
                } else if (type === 'transit') {
                    markerIcon = { url: "http://maps.google.com/mapfiles/ms/icons/purple-dot.png" };
                    markerLabel = "T";
                    markerTitle = "Transit";
                } else {
                    markerIcon = { url: "http://maps.google.com/mapfiles/ms/icons/red-dot.png" };
                    markerLabel = "?";
                    markerTitle = "Unknown";
                }
                const marker = new google.maps.Marker({
                    position: { lat: parseFloat(point.latitude), lng: parseFloat(point.longitude) },
                    map: map,
                    icon: markerIcon,
                    label: markerLabel,
                    title: `${markerTitle}: ${point.address || ''}`
                });

                // Show info window with location overview on marker click
                marker.addListener('click', function () {
                    let content = `<div style="min-width:180px;max-width:300px;">
                        <b>${markerTitle}</b><br/>
                        <b>Address:</b> ${point.address || 'N/A'}<br/>
                        <b>Latitude:</b> ${point.latitude || 'N/A'}<br/>
                        <b>Longitude:</b> ${point.longitude || 'N/A'}<br/>`;
                    if (point.landmark) {
                        content += `<b>Landmark:</b> ${point.landmark}<br/>`;
                    }
                    if (point.city) {
                        content += `<b>City:</b> ${point.city}<br/>`;
                    }
                    if (point.state) {
                        content += `<b>State:</b> ${point.state}<br/>`;
                    }
                    if (point.pincode) {
                        content += `<b>Pincode:</b> ${point.pincode}<br/>`;
                    }
                    content += `</div>`;
                    infoWindow.setContent(content);
                    infoWindow.open(map, marker);
                });

                window._routeMarkers.push(marker);
            });
            // --- End marker logic ---

            // Set distance/duration for selected route
            const selectedRoute = res.routes[selectedIdx];
            let totalMeters = 0;
            let totalSeconds = 0;
            selectedRoute.legs.forEach(leg => {
                totalMeters += leg.distance.value;
                totalSeconds += leg.duration.value;
            });

            frm.set_value('trip_distance', (totalMeters / 1000).toFixed(2));
            frm.set_value('trip_duration', formatDuration(totalSeconds));

            // Calculate bounds for all routes
            const bounds = new google.maps.LatLngBounds();
            res.routes.forEach((route) => {
                route.overview_path.forEach((latlng) => {
                    bounds.extend(latlng);
                });
            });
            map.fitBounds(bounds);

            // Show a legend for route selection
            let legendHtml = '<div style="margin-top:8px">';
            res.routes.forEach((route, idx) => {
                const label = String.fromCharCode(65 + idx);
                const isSel = idx === selectedIdx;
                let meters = 0, seconds = 0;
                route.legs.forEach(leg => {
                    meters += leg.distance.value;
                    seconds += leg.duration.value;
                });
                legendHtml += `<span style="margin-right:16px;cursor:pointer;font-weight:${isSel ? 'bold' : 'normal'};color:${isSel ? '#1976D2' : '#757575'}" onclick="window.selectRouteOnMap(${idx})">
                    Route ${label}: ${(meters/1000).toFixed(2)} km, ${formatDuration(seconds)}
                </span>`;
            });
            legendHtml += '</div>';
            wrap.append(legendHtml);

            // Expose a global for legend click
            window.selectRouteOnMap = function(idx) {
                frm.selectedRouteIdx = idx;
                renderFullTripRoute(frm);
            };

        } else {
            // Show custom error for transit mode if not found
            if (travelMode === google.maps.TravelMode.TRANSIT && status === 'ZERO_RESULTS') {
                frappe.msgprint('Transit route not found for the selected points. Please check your locations or try another mode.');
            } else if (status === 'ZERO_RESULTS') {
                let modeName = frm.doc.mode_selector ? frm.doc.mode_selector.charAt(0).toUpperCase() + frm.doc.mode_selector.slice(1).toLowerCase() : 'selected mode';
                frappe.msgprint(`No route could be found for <b>${modeName}</b> mode. Please select a travel mode available for this route according to Google Maps, such as <b>Driving</b>, <b>Bicycling</b>, <b>Transit</b>, or <b>Walking</b>.`);
            } else {
                frappe.msgprint(`Could not draw route: ${status}`);
            }
            frm.set_value('trip_distance', 0);
            frm.set_value('trip_duration', '');
        }
    });
}

// Add smooth scroll for navigation
document.querySelectorAll('nav a').forEach(link => {
    link.addEventListener('click', function(e) {
        const href = this.getAttribute('href');
        if (href.startsWith('#')) {
            e.preventDefault();
            document.querySelector(href).scrollIntoView({ behavior: 'smooth' });
        }
    });
});

// Minimal, robust UI initializer for all docs pages
document.addEventListener('DOMContentLoaded', function () {
  const root = document.documentElement;
  const pageKey = root.getAttribute('data-page') || 'home';

  // --- Theme Toggler ---
  const themeToggle = document.getElementById('themeToggle');
  const storedTheme = localStorage.getItem('docs-theme');
  if (storedTheme) {
    root.setAttribute('data-theme', storedTheme);
  }
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = root.getAttribute('data-theme');
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', newTheme);
      localStorage.setItem('docs-theme', newTheme);
    });
  }

  // --- Mobile Sidebar ---
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  // --- Active Sidebar Link ---
  const sidebarLinks = document.querySelectorAll('.sidebar nav a');
  sidebarLinks.forEach(link => {
    if (link.getAttribute('href').includes(pageKey)) {
      link.classList.add('active');
    }
  });

  // --- On This Page TOC ---
  const tocContainer = document.getElementById('on-this-page-list');
  if (tocContainer) {
    const headings = document.querySelectorAll('.doc-container h2');
    if (headings.length > 0) {
      headings.forEach(h => {
        const id = h.id || h.textContent.toLowerCase().replace(/\s+/g, '-');
        h.id = id;
        const link = document.createElement('a');
        link.href = `#${id}`;
        link.textContent = h.textContent;
        const li = document.createElement('li');
        li.appendChild(link);
        tocContainer.appendChild(li);
      });

      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const id = entry.target.getAttribute('id');
          const tocLink = tocContainer.querySelector(`a[href="#${id}"]`);
          if (entry.isIntersecting) {
            tocContainer.querySelectorAll('a').forEach(l => l.classList.remove('active'));
            if (tocLink) tocLink.classList.add('active');
          }
        });
      }, { rootMargin: `-${var(--topbar-h)}px 0px -70% 0px` });

      headings.forEach(h => observer.observe(h));
    } else {
        document.querySelector('.on-this-page').style.display = 'none';
    }
  }

  // --- Footer Pager ---
  const footerNav = document.querySelector('.footer-nav');
  if (footerNav) {
    const pages = [
      { key: 'index', href: 'index.html', title: 'Home' },
      { key: 'introduction', href: 'introduction.html', title: 'Introduction' },
      { key: 'installation', href: 'installation.html', title: 'Installation' },
      { key: 'user-guide', href: 'user-guide.html', title: 'User Guide' },
      { key: 'developer-guide', href: 'developer-guide.html', title: 'Developer Guide' },
      { key: 'api', href: 'api.html', title: 'API Reference' },
      { key: 'glossary', href: 'glossary.html', title: 'Glossary' },
      { key: 'faq', href: 'faq.html', title: 'FAQ' },
      { key: 'changelog', href: 'changelog.html', title: 'Changelog' },
      { key: 'about', href: 'about.html', title: 'About' }
    ];
    const currentIndex = pages.findIndex(p => p.key === pageKey);

    const prevPage = currentIndex > 0 ? pages[currentIndex - 1] : null;
    const nextPage = currentIndex < pages.length - 1 ? pages[currentIndex + 1] : null;

    let prevHtml = `<span class="nav-btn prev disabled">&laquo; Previous</span>`;
    if (prevPage) {
      prevHtml = `<a href="${prevPage.href}" class="nav-btn prev">&laquo; ${prevPage.title}</a>`;
    }

    let nextHtml = `<span class="nav-btn next disabled">Next &raquo;</span>`;
    if (nextPage) {
      nextHtml = `<a href="${nextPage.href}" class="nav-btn next">${nextPage.title} &raquo;</a>`;
    }
    footerNav.innerHTML = `${prevHtml}${nextHtml}`;
  }
});