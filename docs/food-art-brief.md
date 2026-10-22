# Food illustrations brief

Instructions for making the fridge's food images in ChatGPT so they match the
existing house illustrations in `public/illustrations/`. Once they're
downloaded, put them in `art/food/` and run `npm run food-art` (see
`public/food/README.md`).

## Instructions for the browser agent

You are making 51 small food illustrations in ChatGPT for a shared-house app.
The user is already signed in to ChatGPT.

1. Open https://chatgpt.com and start a **new chat**. Use the same chat for
   every image so the style stays consistent.
2. Wait for the user to attach the three reference images (`fridge.png`,
   `dishes.png`, `house.png`). Do not continue until they are attached.
3. Send the **Setup message** below, together with the references. Wait for the
   reply.
4. For each row in the **Image list**, send exactly:
   `Next: <subject>` and wait for the image to finish.
5. Check each image before moving on. Regenerate it once (reply
   `Again, closer to the references`) if any of these are true:
   - the background isn't actually transparent (a grey/white checkerboard drawn
     into the image counts as NOT transparent)
   - it has text, labels, logos or more than one main object
   - the colours, lighting or clay look clearly differ from the references
6. Download each finished image and name it with the row's filename
   (for example `milk.png`). Ask the user before the first download, and tell
   them where the files are being saved.
7. If ChatGPT says you've hit a usage limit, stop and tell the user which
   filename you got up to.
8. Do not change any ChatGPT settings, and do not send anything other than the
   messages described here.

When done, report which filenames were made and which were skipped.

## Setup message

> I'm making a set of small food icons for an app. Match the style of the three
> attached images exactly. Every image I ask for should use this style:
>
> Premium soft matte 3D clay still life, rounded friendly forms, subtle realistic
> material texture, gentle diffuse studio light from the upper left, delicate
> contact shadow. Food keeps its natural colours, slightly muted so it sits with
> a warm ivory, sage green and olive palette with small terracotta accents.
> ONE single object, centred in a square with generous transparent padding,
> three-quarter view. Bold simple silhouette that still reads at 28–40 pixels;
> no small details. Actual transparent background. No writing, letters,
> numbers, typography, labels, watermark, logos, frames, arrows, or UI mockup.
>
> Square 1024×1024 PNG with a transparent background. I'll send one subject at a
> time as "Next: <subject>". Reply with just the image.

## Image list

| Filename | Subject |
|---|---|
| `milk.png` | a small ivory milk carton with a sage-green cap |
| `yogurt.png` | a round yogurt cup with a peeled-back foil lid |
| `egg.png` | three brown eggs in a small piece of egg carton |
| `butter.png` | a block of butter on a small ivory butter dish |
| `cheese.png` | a wedge of yellow cheese with a few holes |
| `steak.png` | a raw red steak on a small ivory plate |
| `chicken.png` | a raw chicken drumstick on a small ivory plate |
| `fish.png` | a salmon fillet on a small ivory plate |
| `shrimp.png` | two pink cooked shrimp |
| `bacon.png` | three strips of raw bacon, gently stacked |
| `ham.png` | a few folded slices of pink ham |
| `sausage.png` | two plump sausages |
| `tofu.png` | a white block of tofu |
| `leftovers.png` | a sage-green food container with its lid slightly open |
| `kimchi.png` | a glass jar of red kimchi with a sage lid |
| `greens.png` | a head of leafy green lettuce |
| `broccoli.png` | a single broccoli crown |
| `carrot.png` | two carrots with green tops |
| `pepper.png` | a red bell pepper |
| `cucumber.png` | a cucumber |
| `mushroom.png` | two brown mushrooms |
| `green-onion.png` | a small bundle of green onions |
| `berries.png` | a small punnet of strawberries and blueberries |
| `grapes.png` | a bunch of green grapes |
| `apple.png` | a red apple with one leaf |
| `lemon.png` | a lemon |
| `banana.png` | a small bunch of three bananas |
| `avocado.png` | an avocado cut in half |
| `tomato.png` | a red tomato |
| `garlic.png` | a bulb of garlic |
| `onion.png` | a yellow onion |
| `potato.png` | two potatoes |
| `bread.png` | a loaf of bread |
| `noodles.png` | a bundle of dried noodles |
| `rice.png` | a small sack of rice |
| `cereal.png` | a cereal box with a blank front |
| `snacks.png` | a crinkled snack bag with a blank front |
| `cookies.png` | a small stack of three cookies |
| `juice.png` | a small carton of orange juice with a straw and no label |
| `sauce.png` | a sauce bottle with a sage cap and no label |
| `spice.png` | a small spice jar |
| `frozen.png` | a frosty resealable freezer bag |
| `dumplings.png` | three dumplings on a small ivory plate |
| `ice-cream.png` | a small tub of ice cream with a scoop on top |
| `paper.png` | a roll of toilet paper next to a roll of paper towel |
| `soap.png` | a sage-green soap pump bottle |
| `garbage-bags.png` | a roll of dark green garbage bags |
| `sponge.png` | a green and yellow kitchen sponge |
| `fallback-fridge.png` | a closed sage-green food container |
| `fallback-freezer.png` | a single ice cube with a little frost |
| `fallback-pantry.png` | a plain tin can with no label |
