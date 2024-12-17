<script setup lang="ts">
import './style.css'
import options from './options.vue';
</script>

<template>
    <div class='content'>
        <div id="img">
            <!-- <img src="/img/hill.svg"> -->
        </div>
        <br>
        <div class="break"></div>
        <!-- <span class="getTitle">Get a Blocklive Pass</span> -->
        <!-- <span class="getSubTitle">Ask your parents to support you</span> -->
        <div class="bigbubble">

            <span class="getTit2"> Select a blocklive subscription</span>

            <div class="options">
                <options name="Individual" :price=1 :perks="['unlimited shares']" />
                <options name="Friends" :price=5 :perks="['10 free passes for friends', 'unlimited shares',]" />
                <options name="Schools" :price=5 :perks="['10 free passes for friends', 'unlimited shares',]" />
                <!-- <options name="Lifetime Pass" :price=20 :perks="['ad-supported',]"/> -->
                <!-- <div class="moreOptions">
                <span></span>
            </div> -->
            </div>
        </div>
        <!-- <a href="/request" class="schools">Schools click here</a> -->
        <a href="/request" class="parents">Me or my parents cant pay</a>
    </div>
</template>

<script lang="ts">

// const stripe = require('stripe')('sk_test_51QNVpI02JNKBBhrZ3EobEcWZss3xM6ubSqvxLCfeD6BmhrvYYkDo28du7dwSVxYxbzetc0bXy0Gltgd5rGxQj2lh002zF2kHJu');

// const session = await stripe.checkout.sessions.create({
//   line_items: [
//     {
//       price: '{{PRICE_ID}}',
//       quantity: 1,
//     },
//   ],
//   mode: 'payment',
//   success_url: 'https://example.com/success',
// });

</script>

<!-- <style src="./style.css"></style> -->