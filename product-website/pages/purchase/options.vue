<script setup lang=ts>
    defineProps<{name:string, perks:string[], price:number}>()
</script>
<template>

     
<form :action="`https://jeffa.uk.to:4242/create-checkout-session?priceId=${'price_1QNpSe02JNKBBhrZzwzr8L9u'}`" method="POST" id="form">
    <div class="option" onclick="document.getElementById('form').submit()">
        <span class="optionName">{{ name }}</span>
        <div class="optionPerks">
            <span class="price">${{ price }}

                <span class="regularity">/month</span>
            </span> 
            <!-- per month -->
            <span class="optionPerk" v-for="perk in perks"> + {{ perk }} </span>
        </div>
    </div>
    </form>

</template>

<style src="./options.css"/>