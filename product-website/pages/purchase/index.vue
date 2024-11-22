<script setup lang="ts">
 import './style.css'
 import options from './options.vue';
</script>

<template>
    <div class='content'>
        <span class="getTitle">Get a Blocklive Pass</span>
        <div class="options">
            <options name="Single User Pass" :price=4 :perks="['unlimited shares']"/>
            <options name="Friends Pass" :price=5 :perks="['4 free passes for friends', 'unlimited shares',]"/>
            <options name="Ad Pass" :price=0 :perks="['ad-supported',]"/>
            <!-- <div class="moreOptions">
                <span></span>
            </div> -->
        </div>
        <a href="/request">My parents cant pay</a>
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