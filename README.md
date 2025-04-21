# serverbrowser.tf

[serverbrowser.tf](https://serverbrowser.tf) is an alternative to the stock TF2
server browser. The root problem with the death of community servers is their
extremely low discoverability. Opening up the stock server browser and sorting
by players today, you'll find pages and pages of 24/7 2fort, Versus Saxton
Hale, 100 player TF2, etc. It would be extremely difficult to spot a vanilla 24
player server that is desperately trying to find new players

serverbrowser.tf is my way of contributing back to the community and creating a
way to find "vanilla" TF2 servers. The site was originally going to only allow
you to filter vanilla, but due to how I designed the site, it lets you filter
for any type of category.

## FAQ

---

### Why is X in vanilla?

There are two possible reasons:

1. My automatic filters didn't catch it, and the server wasn't manually
   categorized. Please wait until I spot it and categorize it.

2. I have an extremely loose definition of "vanilla." Really it's only named
   "vanilla" for a lack of a better word. For a server to be considered
   vanilla, it must meet two criteria:

   - It has to be "rotational," meaning it doesn't stay on the same map 24/7.
   - It must not significantly alter TF2's gameplay.

   Examples of what **is** allowed:
   - Custom weapons
   - Weapon balancing
   - balloon_race/wacky_races
   - Vscript VIP gamemode

   Examples of what **isn't** allowed:
   - Vscript Versus Saxton Hale
   - 10x
   - randomizer
   - dodgeball
   - Class wars

   This definition is extremely subjective I admit. Vscript VSH is basically a
   stock TF2 gamemode at this point, while VIP is a niche gamemode that was
   rejected by valve 20 years ago. Weapon balancing is allowed but 10x isn't

---

### Why do you have a "comp" category?

Solely because of how I designed it, it was completely free to add it without
any work. Also because of how I designed it, I had to put the servers
somewhere, and it didn't feel right keeping them in vanilla. It just takes up
too much screen real estate when the average user experience is to find
community servers to play right now.

---

### Why not quickplay.tf?/This will be fixed with quickplay

I have my own reservations against quickplay. Mainly due to my preference of
the stock server browser. The server browser is the greatest piece of
technology the world has ever produced and there's nothing anyone can say to
convince me otherwise

---

### Build instructions???

If you have to ask, you probably shouldn't even bother...

---

### Requirements

Just bun

---

### Can I use this to open up my own competing site and run you out of town?

I never wanted the clout or responsibility. If you can make a better site, go
for it. We all win.

---

### Will you share the data you've collected?

I won't give a flat no to providing the database, but it's not a priority right
now. There are a couple of challenges with providing the raw database copy.
Some servers are hosted on residential static IP. I'd rather not be responsible
for doxing someone who opened up a server 3 months ago for a grand total of 5
minutes. At the time of this writing, data never gets removed. I've just never
bothered doing any cleanup scripts. Once that's done I could easily provide an
up to date real time copy of the database

Until then, if anyone's curious and wants some custom analytics, feel free to
open an issue. I can either add it to the main site or provide a one-time
report.
