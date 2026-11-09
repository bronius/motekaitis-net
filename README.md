# motekaitis.net

The Motekaitis family, drawn as a mycelium network on old parchment. A looking glass sits in the middle of the map: whoever is under it gets their details shown in the side panel (desktop) or bottom panel (phones). Close family is drawn clearly and more distant family fades out.

No build step. GitHub Pages serves the files as they are.

- `index.html` holds **the data**: every family unit is a semantic `<article>` with schema.org `Person` microdata. Search engines, AI parsers and visitors without JavaScript read this directly.
- `js/mycelium.js` reads those articles, works out the generations, and draws the map.
- `css/style.css` holds every style: the plain readable list, the map, and the panel.

## Getting around the map

- Drag (or scroll) the map. When you let go, the nearest family unit slides under the glass.
- Tap or click any family unit, even a faded one.
- Use the arrows around the glass, or the keyboard arrow keys.
- Every unit has its own link, for example `motekaitis.net/#bronius-motekaitis`.

## Adding people

A **family unit** is either a couple or one person. Paste a template into `index.html` inside `<section id="families">`.

How units connect:

- **Parents:** inside each person, add `<a itemprop="parent" href="#their-parent-id">`.
- **Children:** in a couple's children list, add `<a itemprop="children" href="#child-id">`.
- A link can point at a person's id or a unit's id. The map finds the right unit either way, and you only need to record a connection on one side.

### One person

```html
<article class="family-unit" id="firstname-lastname">
  <div class="person" itemscope itemtype="https://schema.org/Person" itemid="https://motekaitis.net/#firstname-lastname">
    <img class="portrait" src="img/firstname-lastname.jpg" alt="Firstname Lastname, about 1960" itemprop="image">
    <h2 itemprop="name"><span itemprop="givenName">Firstname</span> <span itemprop="familyName">Lastname</span></h2>
    <p class="lineage">Son of <a itemprop="parent" href="#mother-id">Mother</a> and <a itemprop="parent" href="#father-id">Father</a></p>
    <div class="bio" itemprop="description">
      <p>A short biography. Any HTML works here.</p>
    </div>
    <section class="links">
      <h3>Of interest</h3>
      <ul>
        <li><a itemprop="sameAs" href="https://example.com">A website about them</a></li>
      </ul>
    </section>
  </div>
</article>
```

The photo and the "Of interest" list are optional.

### A couple

```html
<article class="family-unit" id="anna-jonas">
  <h2>Anna &amp; Jonas Lastname</h2>

  <section class="person" id="anna-lastname" itemscope itemtype="https://schema.org/Person" itemid="https://motekaitis.net/#anna-lastname" itemref="children-anna-jonas">
    <h3 itemprop="name"><span itemprop="givenName">Anna</span> <span itemprop="familyName">Lastname</span></h3>
    <p class="lineage">Daughter of <a itemprop="parent" href="#her-mother">…</a> and <a itemprop="parent" href="#her-father">…</a></p>
    <link itemprop="spouse" href="#jonas-lastname">
    <div class="bio" itemprop="description"><p>…</p></div>
  </section>

  <section class="person" id="jonas-lastname" itemscope itemtype="https://schema.org/Person" itemid="https://motekaitis.net/#jonas-lastname" itemref="children-anna-jonas">
    <h3 itemprop="name"><span itemprop="givenName">Jonas</span> <span itemprop="familyName">Lastname</span></h3>
    <link itemprop="spouse" href="#anna-lastname">
    <div class="bio" itemprop="description"><p>…</p></div>
  </section>

  <section class="children">
    <h3>Children</h3>
    <ul id="children-anna-jonas">
      <li><a itemprop="children" href="#child-id">Child Name</a></li>
    </ul>
  </section>
</article>
```

When a single person marries, turn their article into a couple. Give the couple a new unit id and keep the person's old id on their `<section class="person">`, so old links still work.

### Map label

The map label is built from the given names and family names. To set your own, add `data-label="…"` to the `<article>`.

### Starting point

`data-start` on `<section id="families">` picks which unit sits under the glass when someone opens the site with no `#link`.
